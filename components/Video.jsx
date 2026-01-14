import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import ShareMenu from 'react-native-share-menu';
import notifee, {
  AndroidImportance,
  AndroidStyle,
} from '@notifee/react-native';
import {
  createDownloadTask,
  directories,
} from '@kesha-antonov/react-native-background-downloader';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import axios from 'axios';

const BACKEND_URL = 'https://tubebackend.onrender.com';
const SHARED_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

export default function Video() {
  const [status, setStatus] = useState('Waiting for link...');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTitle, setCurrentTitle] = useState('');

  useEffect(() => {
    notifee.requestPermission();
    ShareMenu.getInitialShare(handleShare);
    const listener = ShareMenu.addNewShareListener(handleShare);
    return () => listener?.remove();
  }, []);

  const handleShare = share => {
    const url = share?.data;
    if (url && typeof url === 'string') fetchAndAutoDownload(url);
  };

  const fetchAndAutoDownload = async url => {
    setLoading(true);
    setProgress(0);
    setStatus('Snatching Link... 🚀');

    try {
      const res = await axios.post(`${BACKEND_URL}/extract`, { url });

      if (res.data.success) {
        setCurrentTitle(res.data.title);
        // Step 2: Auto Start Download
        startDownloadLogic(res.data);
      } else {
        setStatus('Extraction Failed ❌');
        setLoading(false);
      }
    } catch (err) {
      setStatus('Server Error ❌');
      setLoading(false);
    }
  };

  const updateNotification = async (p, title, thumb, isDone = false) => {
    const channelId = await notifee.createChannel({
      id: 'downloader',
      name: 'Video Downloader',
      importance: AndroidImportance.HIGH,
    });

    await notifee.displayNotification({
      id: 'dl_task',
      title: isDone ? 'Download Complete ✅' : 'Downloading...',
      body: isDone ? `Saved: ${title}` : `${p}% - ${title.substring(0, 30)}...`,
      android: {
        channelId,
        onlyAlertOnce: true,
        largeIcon: thumb || undefined,
        // Snaptube Style: Big Picture/Icon support
        style: isDone
          ? undefined
          : { type: AndroidStyle.BIGTEXT, text: `${p}% completed of ${title}` },
        progress: { max: 100, current: p, indeterminate: false },
        ongoing: !isDone,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
      },
    });
  };

  const startDownloadLogic = async video => {
    setStatus('Downloading Started... ⬇️');
    const fileName = `Tube_${Date.now()}.mp4`;
    const filePath = `${directories.documents}/${fileName}`;

    const task = createDownloadTask({
      id: fileName,
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

    task
      .begin(() => updateNotification(0, video.title, video.thumbnail))
      .progress(({ bytesDownloaded, bytesTotal }) => {
        const p = Math.floor((bytesDownloaded / bytesTotal) * 100);
        setProgress(p);
        if (p % 10 === 0) updateNotification(p, video.title, video.thumbnail);
      })
      .done(async () => {
        try {
          await CameraRoll.saveAsset(`file://${filePath}`, {
            type: 'video',
            album: 'TubeApp',
          });
          await updateNotification(100, video.title, video.thumbnail, true);
          setStatus('Video Saved Successfully! ✅');
        } catch (e) {
          setStatus('Saved in Storage');
        }
        setLoading(false);
        setProgress(0);
      })
      .error(() => {
        setStatus('Download Failed ❌');
        setLoading(false);
        notifee.cancelNotification('dl_task');
      })
      .start();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>TubeDownloader</Text>
      <View style={styles.card}>
        <Text style={styles.title} numberOfLines={2}>
          {loading
            ? currentTitle || 'Processing...'
            : 'Share link from YT/Insta'}
        </Text>

        <Text style={[styles.status, { color: loading ? '#FF0000' : '#666' }]}>
          {status}
        </Text>

        {loading && (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#FF0000" />
            {progress > 0 && (
              <View style={styles.progressBox}>
                <View style={styles.barContainer}>
                  <View style={[styles.barFill, { width: `${progress}%` }]} />
                </View>
                <Text style={styles.progressText}>{progress}%</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    padding: 20,
    justifyContent: 'center',
  },
  header: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FF0000',
    textAlign: 'center',
    marginBottom: 40,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 30,
    padding: 40,
    elevation: 15,
    shadowColor: '#000',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    color: '#222',
    marginBottom: 10,
  },
  status: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '500',
  },
  loaderContainer: { alignItems: 'center' },
  progressBox: { width: '100%', marginTop: 20 },
  barContainer: {
    height: 12,
    backgroundColor: '#eee',
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: '#28a745' },
  progressText: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
});
