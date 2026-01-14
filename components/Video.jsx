import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import ShareMenu from 'react-native-share-menu';
import notifee, { AndroidImportance } from '@notifee/react-native';
import {
  createDownloadTask,
  directories,
} from '@kesha-antonov/react-native-background-downloader';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import axios from 'axios';

// Render Backend URL
const BACKEND_URL = 'https://tubebackend.onrender.com';

// Snaptube uses a consistent User-Agent to match Backend & Frontend
const SHARED_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default function Video() {
  const [status, setStatus] = useState('Wait for link...');
  const [loading, setLoading] = useState(false);
  const [videoData, setVideoData] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    notifee.requestPermission();
    ShareMenu.getInitialShare(handleShare);
    const listener = ShareMenu.addNewShareListener(handleShare);
    return () => listener?.remove();
  }, []);

  const handleShare = share => {
    const url = share?.data;
    if (url && typeof url === 'string') fetchVideoInfo(url);
  };

  const fetchVideoInfo = async url => {
    setLoading(true);
    setVideoData(null);
    setStatus('Snatching Link... 🚀');
    try {
      // Backend se direct extraction
      const res = await axios.post(`${BACKEND_URL}/extract`, { url });

      if (res.data.success) {
        setVideoData(res.data);
        setStatus('Ready to Download! ✅');
      } else {
        setStatus('Extraction Failed ❌');
        Alert.alert('Error', res.data.error || 'Could not fetch link');
      }
    } catch (err) {
      console.log(err);
      setStatus('Server Error ❌');
    } finally {
      setLoading(false);
    }
  };

  // --- NOTIFICATION ---
  async function updateNotification(p) {
    const channelId = await notifee.createChannel({
      id: 'dl',
      name: 'Downloads',
      importance: AndroidImportance.LOW,
    });
    await notifee.displayNotification({
      id: 'dl_id',
      title: 'Downloading Video...',
      body: `${p}% completed`,
      android: {
        channelId,
        onlyAlertOnce: true,
        progress: { max: 100, current: p },
      },
    });
  }

  const startDownload = async () => {
    if (!videoData?.videoUrl) return;

    setStatus('Starting Download...');
    const fileName = `Tube_${Date.now()}.mp4`;
    const filePath = `${directories.documents}/${fileName}`;

    // Snaptube secret: Headers matching
    const task = createDownloadTask({
      id: fileName,
      url: videoData.videoUrl,
      destination: filePath,
      headers: {
        'User-Agent': SHARED_USER_AGENT,
        Referer:
          videoData.source === 'youtube'
            ? 'https://www.youtube.com/'
            : 'https://www.instagram.com/',
      },
    });

    task
      .begin(() => updateNotification(0))
      .progress(({ bytesDownloaded, bytesTotal }) => {
        const p = Math.floor((bytesDownloaded / bytesTotal) * 100);
        setProgress(p);
        if (p % 5 === 0) updateNotification(p);
      })
      .done(async () => {
        setStatus('Finalizing Gallery Save...');
        try {
          await CameraRoll.saveAsset(`file://${filePath}`, {
            type: 'video',
            album: 'TubeApp',
          });
          await notifee.displayNotification({
            title: 'Success! ✔',
            body: 'Video saved to Gallery',
            android: { channelId: 'dl' },
          });
          setStatus('Saved to Gallery! ✔');
        } catch (e) {
          setStatus('Saved in Downloads folder');
        }
        setProgress(0);
        setVideoData(null);
      })
      .error(err => {
        console.log(err);
        setStatus('Download Failed ❌');
      })
      .start();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>TubeDownloader</Text>

      <View style={styles.card}>
        {loading ? (
          <View>
            <ActivityIndicator size="large" color="#FF0000" />
            <Text style={styles.loaderText}>{status}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.title} numberOfLines={2}>
              {videoData?.title || 'Share a video link to start'}
            </Text>
            <Text style={styles.status}>{status}</Text>

            {progress > 0 && (
              <View style={styles.barContainer}>
                <View style={[styles.barFill, { width: `${progress}%` }]} />
                <Text style={styles.progressLabel}>{progress}%</Text>
              </View>
            )}

            {videoData && (
              <TouchableOpacity style={styles.btn} onPress={startDownload}>
                <Text style={styles.btnText}>DOWNLOAD 720p</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
    padding: 20,
    justifyContent: 'center',
  },
  header: {
    fontSize: 34,
    fontWeight: 'bold',
    color: '#FF0000',
    textAlign: 'center',
    marginBottom: 50,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 25,
    padding: 30,
    elevation: 12,
    shadowColor: '#000',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 15,
    color: '#333',
  },
  status: { color: '#666', textAlign: 'center', marginBottom: 25 },
  loaderText: { textAlign: 'center', marginTop: 10, color: '#FF0000' },
  btn: {
    backgroundColor: '#FF0000',
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  barContainer: {
    height: 14,
    backgroundColor: '#eee',
    borderRadius: 7,
    marginBottom: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: { height: '100%', backgroundColor: '#28a745' },
  progressLabel: {
    position: 'absolute',
    width: '100%',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: 'bold',
    color: '#000',
  },
});
