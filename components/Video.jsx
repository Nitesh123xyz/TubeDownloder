import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ShareMenu from 'react-native-share-menu';
import notifee, {
  AndroidImportance,
  AndroidStyle,
} from '@notifee/react-native';
import {
  createDownloadTask,
  directories,
  getExistingDownloadTasks,
} from '@kesha-antonov/react-native-background-downloader';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import axios from 'axios';
import RNFS from 'react-native-fs';

const BACKEND_URL = 'https://tubebackend.onrender.com';
const DOWNLOADS_FILE = `${RNFS.DocumentDirectoryPath}/tube-downloads.json`;
const SHARED_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const getErrorMessage = error =>
  (typeof error === 'string' && error) ||
  error?.message ||
  error?.error ||
  'An unexpected error occurred.';

export default function Video() {
  const [downloads, setDownloads] = useState([]);
  const [page, setPage] = useState('home');
  const [storageError, setStorageError] = useState('');
  const downloadsRef = useRef([]);
  const attachedTaskIds = useRef(new Set());
  const persistQueue = useRef(Promise.resolve());

  const persistDownloads = useCallback(nextDownloads => {
    persistQueue.current = persistQueue.current
      .catch(error => {
        console.warn('Previous download history save failed:', error);
      })
      .then(() =>
        RNFS.writeFile(
          DOWNLOADS_FILE,
          JSON.stringify(nextDownloads),
          'utf8',
        ),
      )
      .then(() => setStorageError(''))
      .catch(error => {
        console.warn('Could not save download history:', error);
        setStorageError('Download history could not be saved.');
      });
  }, []);

  const updateDownload = useCallback(
    (id, changes, shouldPersist = true) => {
      const current = downloadsRef.current;
      const existing = current.find(download => download.id === id);
      if (!existing) return;

      const updated = { ...existing, ...changes, updatedAt: Date.now() };
      const nextDownloads = [
        updated,
        ...current.filter(download => download.id !== id),
      ];
      downloadsRef.current = nextDownloads;
      setDownloads(nextDownloads);
      if (shouldPersist) persistDownloads(nextDownloads);
      return updated;
    },
    [persistDownloads],
  );

  const addDownload = useCallback(
    download => {
      const nextDownloads = [download, ...downloadsRef.current];
      downloadsRef.current = nextDownloads;
      setDownloads(nextDownloads);
      persistDownloads(nextDownloads);
    },
    [persistDownloads],
  );

  const updateNotification = useCallback(
    async (download, progress, isDone = false) => {
      try {
        const channelId = await notifee.createChannel({
          id: 'downloader',
          name: 'Video Downloader',
          importance: AndroidImportance.HIGH,
        });

        await notifee.displayNotification({
          id: `download-${download.id}`,
          title: isDone ? 'Download Complete' : 'Downloading...',
          body: isDone
            ? `Saved: ${download.title}`
            : `${progress}% - ${download.title.substring(0, 30)}`,
          android: {
            channelId,
            onlyAlertOnce: true,
            largeIcon: download.thumbnail || undefined,
            style: isDone
              ? undefined
              : {
                  type: AndroidStyle.BIGTEXT,
                  text: `${progress}% completed of ${download.title}`,
                },
            progress: { max: 100, current: progress, indeterminate: false },
            ongoing: !isDone,
            importance: AndroidImportance.HIGH,
            pressAction: { id: 'default' },
          },
        });
      } catch (error) {
        console.warn('Could not update download notification:', error);
      }
    },
    [],
  );

  const completeDownload = useCallback(
    async (download, filePath) => {
      let fileExists;
      try {
        fileExists = await RNFS.exists(filePath);
      } catch (error) {
        console.warn('Could not verify completed download:', error);
        updateDownload(download.id, {
          status: 'failed',
          taskId: null,
          error: getErrorMessage(error),
        });
        return;
      }

      if (!fileExists) {
        updateDownload(download.id, {
          status: 'failed',
          taskId: null,
          error: 'Downloaded file was not found in storage.',
        });
        return;
      }

      let galleryError = '';
      try {
        await CameraRoll.saveAsset(`file://${filePath}`, {
          type: 'video',
          album: 'TubeApp',
        });
      } catch (error) {
        galleryError = `File saved in app storage, but could not be added to the gallery: ${getErrorMessage(error)}`;
        console.warn('Could not save download to CameraRoll:', error);
      }

      updateDownload(download.id, {
        filePath,
        status: 'completed',
        progress: 100,
        taskId: null,
        error: galleryError,
      });
      await updateNotification(download, 100, true);
    },
    [updateDownload, updateNotification],
  );

  const bindDownloadTask = useCallback(
    (download, task, taskId, isNewTask) => {
      if (attachedTaskIds.current.has(taskId)) return;
      attachedTaskIds.current.add(taskId);

      let chain = task;
      if (isNewTask) {
        chain = chain.begin(() => {
          updateDownload(download.id, { status: 'downloading' });
          updateNotification(download, 0);
        });
      }

      chain
        .progress(({ bytesDownloaded, bytesTotal }) => {
          const progress =
            bytesTotal > 0
              ? Math.min(100, Math.floor((bytesDownloaded / bytesTotal) * 100))
              : 0;
          const currentDownload = downloadsRef.current.find(
            item => item.id === download.id,
          );
          const shouldPersist =
            progress === 100 ||
            !currentDownload ||
            progress - currentDownload.progress >= 10;
          updateDownload(
            download.id,
            { progress, status: 'downloading' },
            shouldPersist,
          );
          if (progress % 10 === 0) {
            updateNotification(download, progress);
          }
        })
        .done(({ location }) => {
          completeDownload(download, location || download.filePath);
        })
        .error(error => {
          attachedTaskIds.current.delete(taskId);
          updateDownload(download.id, {
            status: 'failed',
            taskId: null,
            error: getErrorMessage(error),
          });
          notifee.cancelNotification(`download-${download.id}`).catch(
            notificationError => {
              console.warn('Could not cancel download notification:', notificationError);
            },
          );
        });

      if (isNewTask) task.start();
    },
    [completeDownload, updateDownload, updateNotification],
  );

  const startDownload = useCallback(
    (download, video) => {
      const fileName = `Tube_${download.id}_attempt_${download.attempt}.mp4`;
      const filePath = `${directories.documents}/${fileName}`;
      const taskId = `${download.id}-attempt-${download.attempt}`;
      const current = updateDownload(download.id, {
        title: video.title,
        thumbnail: video.thumbnail || '',
        source: video.source || '',
        videoUrl: video.videoUrl,
        filePath,
        taskId,
        status: 'downloading',
        progress: 0,
        error: '',
      });
      if (!current) return;

      try {
        const task = createDownloadTask({
          id: taskId,
          url: video.videoUrl,
          destination: filePath,
          headers: {
            'User-Agent': SHARED_USER_AGENT,
            Referer:
              video.source === 'youtube'
                ? 'https://www.youtube.com/'
                : 'https://www.instagram.com/',
          },
        });
        bindDownloadTask(current, task, taskId, true);
      } catch (error) {
        updateDownload(download.id, {
          status: 'failed',
          taskId: null,
          error: getErrorMessage(error),
        });
      }
    },
    [bindDownloadTask, updateDownload],
  );

  const fetchAndAutoDownload = useCallback(
    async (url, existingDownload) => {
      const download =
        existingDownload || {
          id: `download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceUrl: url,
          title: 'Extracting video details...',
          thumbnail: '',
          source: '',
          videoUrl: '',
          filePath: '',
          taskId: null,
          status: 'extracting',
          progress: 0,
          attempt: 1,
          error: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

      if (!existingDownload) addDownload(download);
      else {
        updateDownload(download.id, {
          status: 'extracting',
          progress: 0,
          taskId: null,
          attempt: download.attempt + 1,
          error: '',
        });
      }

      try {
        const response = await axios.post(`${BACKEND_URL}/extract`, { url });
        const video = response.data;
        console.log('Extracted video data:', video);
        if (
          !video?.success ||
          typeof video.title !== 'string' ||
          typeof video.videoUrl !== 'string' ||
          !video.videoUrl
        ) {
          throw new Error(video?.message || 'Video extraction failed.');
        }

        const latestDownload =
          downloadsRef.current.find(item => item.id === download.id) || download;
        startDownload(latestDownload, video);
      } catch (error) {
        updateDownload(download.id, {
          status: 'failed',
          taskId: null,
          error: getErrorMessage(error),
        });
      }
    },
    [addDownload, startDownload, updateDownload],
  );

  const handleShare = useCallback(
    share => {
      const url = share?.data;
      if (url && typeof url === 'string') {
        fetchAndAutoDownload(url);
      }
    },
    [fetchAndAutoDownload],
  );

  useEffect(() => {
    let active = true;
    let shareListener;

    const initialize = async () => {
      try {
        if (await RNFS.exists(DOWNLOADS_FILE)) {
          const savedDownloads = JSON.parse(
            await RNFS.readFile(DOWNLOADS_FILE, 'utf8'),
          );
          if (Array.isArray(savedDownloads) && active) {
            const recoveredDownloads = savedDownloads.map(download =>
              download.status === 'extracting'
                ? {
                    ...download,
                    status: 'failed',
                    error: 'App closed before video details were retrieved.',
                  }
                : download,
            );
            downloadsRef.current = recoveredDownloads;
            setDownloads(recoveredDownloads);
            persistDownloads(recoveredDownloads);
          }
        }
      } catch (error) {
        console.warn('Could not load download history:', error);
        if (active) setStorageError('Download history could not be loaded.');
      }

      try {
        const runningTasks = await getExistingDownloadTasks();
        const runningTaskIds = new Set(runningTasks.map(task => task.id));
        runningTasks.forEach(task => {
          const download = downloadsRef.current.find(
            item => item.taskId === task.id && item.status === 'downloading',
          );
          if (!download || !active) return;

          if (task.state === 'DONE') {
            completeDownload(download, download.filePath);
          } else if (task.state === 'FAILED' || task.state === 'STOPPED') {
            updateDownload(download.id, {
              status: 'failed',
              taskId: null,
              error: 'Download did not finish. Retry to try again.',
            });
          } else {
            bindDownloadTask(download, task, task.id, false);
            if (task.state === 'PAUSED') {
              task.resume().catch(error => {
                updateDownload(download.id, {
                  status: 'failed',
                  taskId: null,
                  error: getErrorMessage(error),
                });
              });
            }
          }
        });

        const untrackedDownloads = downloadsRef.current.filter(
          download =>
            download.status === 'downloading' &&
            download.taskId &&
            !runningTaskIds.has(download.taskId),
        );
        for (const download of untrackedDownloads) {
          if (await RNFS.exists(download.filePath)) {
            await completeDownload(download, download.filePath);
          } else {
            updateDownload(download.id, {
              status: 'failed',
              taskId: null,
              error: 'Download did not finish. Retry to try again.',
            });
          }
        }
      } catch (error) {
        console.warn('Could not restore active downloads:', error);
        if (active) setStorageError('Active downloads could not be restored.');
      }

      if (active) {
        shareListener = ShareMenu.addNewShareListener(handleShare);
        ShareMenu.getInitialShare(handleShare);
      }
    };

    notifee.requestPermission().catch(error => {
      console.warn('Could not request notification permission:', error);
    });
    initialize();

    return () => {
      active = false;
      shareListener?.remove();
    };
  }, [
    bindDownloadTask,
    completeDownload,
    handleShare,
    persistDownloads,
    updateDownload,
  ]);

  const retryDownload = download => {
    if (download.status === 'failed' && download.sourceUrl) {
      fetchAndAutoDownload(download.sourceUrl, download);
    }
  };

  const activeCount = downloads.filter(
    download =>
      download.status === 'extracting' || download.status === 'downloading',
  ).length;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>TUBE DOWNLOADER</Text>
      </View>
      <View style={styles.navigation}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPage('home')}
          style={[styles.navButton, page === 'home' && styles.activeNavButton]}>
          <Text
            style={[
              styles.navText,
              page === 'home' && styles.activeNavText,
            ]}>
            Home
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPage('downloads')}
          style={[
            styles.navButton,
            page === 'downloads' && styles.activeNavButton,
          ]}>
          <Text
            style={[
              styles.navText,
              page === 'downloads' && styles.activeNavText,
            ]}>
            Downloads ({downloads.length})
          </Text>
        </Pressable>
      </View>

      {storageError ? (
        <Text style={styles.storageError}>{storageError}</Text>
      ) : null}

      {page === 'home' ? (
        <View style={styles.card}>
          <Text style={styles.title}>Share a Instagram link</Text>
          <Text style={styles.status}>
            {activeCount
              ? `${activeCount} download${activeCount === 1 ? '' : 's'} in progress`
              : 'Waiting for a shared link...'}
          </Text>
          <Text style={styles.hint}>
            Share a video link to start a download. You can track all files and
            retry failed downloads in the Downloads page.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.downloadList}>
          {downloads.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>No downloads yet.</Text>
            </View>
          ) : (
            downloads.map(download => (
              <View key={download.id} style={styles.downloadCard}>
                <Text style={styles.downloadTitle} numberOfLines={2}>
                  {download.title}
                </Text>
                <Text style={styles.downloadStatus}>
                  {download.status === 'extracting'
                    ? 'Getting video details...'
                    : download.status === 'downloading'
                      ? `Downloading — ${download.progress}%`
                      : download.status === 'completed'
                        ? 'Completed'
                        : 'Failed'}
                </Text>

                {(download.status === 'downloading' ||
                  download.status === 'completed') && (
                  <View style={styles.progressBox}>
                    <View style={styles.barContainer}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${download.progress}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.progressText}>
                      {download.progress}%
                    </Text>
                  </View>
                )}

                {download.filePath &&
                (download.status === 'downloading' ||
                  download.status === 'completed') ? (
                  <Text selectable style={styles.filePath}>
                    File: {download.filePath}
                  </Text>
                ) : null}
                {download.error ? (
                  <Text style={styles.errorText}>{download.error}</Text>
                ) : null}
                {download.status === 'failed' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => retryDownload(download)}
                    style={styles.retryButton}>
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    padding: 20,
  },
  headerRow: {
    paddingTop: 24,
    paddingBottom: 20,
  },
  header: {
    fontSize: 25,
    fontWeight: 'bold',
    color: '#FF0000',
    textAlign: 'center',
  },
  navigation: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  navButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 9,
  },
  activeNavButton: {
    backgroundColor: '#FF0000',
  },
  navText: {
    color: '#555',
    fontWeight: '600',
  },
  activeNavText: {
    color: '#fff',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    elevation: 8,
    shadowColor: '#000',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    color: '#222',
    marginBottom: 12,
  },
  status: {
    fontSize: 15,
    textAlign: 'center',
    color: '#FF0000',
    marginBottom: 16,
    fontWeight: '600',
  },
  hint: {
    color: '#666',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  storageError: {
    color: '#b00020',
    marginBottom: 12,
    textAlign: 'center',
  },
  downloadList: {
    paddingBottom: 24,
    gap: 12,
  },
  downloadCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    elevation: 3,
    shadowColor: '#000',
  },
  downloadTitle: {
    color: '#222',
    fontSize: 16,
    fontWeight: '700',
  },
  downloadStatus: {
    color: '#555',
    fontSize: 14,
    marginTop: 8,
  },
  progressBox: {
    width: '100%',
    marginTop: 14,
  },
  barContainer: {
    height: 10,
    backgroundColor: '#eee',
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#28a745',
  },
  progressText: {
    textAlign: 'right',
    marginTop: 5,
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
  },
  filePath: {
    color: '#555',
    fontSize: 12,
    marginTop: 12,
  },
  errorText: {
    color: '#b00020',
    fontSize: 13,
    marginTop: 8,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#FF0000',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginTop: 14,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    fontSize: 15,
  },
});
