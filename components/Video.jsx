import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Alert,
  PermissionsAndroid,
  Platform,
  TouchableOpacity,
} from 'react-native';

import ShareMenu from 'react-native-share-menu';
import RNFS from 'react-native-fs';
import axios from 'axios';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';

export default function Video() {
  const [status, setStatus] = useState('Waiting for Instagram link…');
  const [title, setTitle] = useState('');
  const [thumbnail, setThumbnail] = useState(null);
  const [progress, setProgress] = useState(0);
  const [quality, setQuality] = useState(720);

  // ---------------- SHARE LISTENER ----------------
  useEffect(() => {
    ShareMenu.getInitialShare(share => {
      if (share) handleShare(share);
    });

    const listener = ShareMenu.addNewShareListener(share => {
      handleShare(share);
    });

    return () => listener?.remove();
  }, []);

  const handleShare = share => {
    const url = share?.data;

    if (!url || typeof url !== 'string') {
      setStatus('Invalid shared data');
      return;
    }

    if (!url.includes('instagram.com')) {
      Alert.alert('Unsupported', 'Only Instagram links are supported');
      return;
    }

    startDownload(url);
  };

  // ---------------- PERMISSION (UNIVERSAL) ----------------
  const requestPermission = async () => {
    if (Platform.OS !== 'android') return true;

    // Android 13+
    if (Platform.Version >= 33) return true;

    // Android 12 and below
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      {
        title: 'Storage Permission',
        message: 'Video save karne ke liye storage permission chahiye',
        buttonPositive: 'Allow',
      },
    );

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  // ---------------- DOWNLOAD LOGIC ----------------
  const startDownload = async instagramUrl => {
    try {
      const allowed = await requestPermission();
      // if (!allowed) {
      //   setStatus('Storage permission denied');
      //   return;
      // }

      setProgress(0);
      setStatus(`Fetching video (${quality}p)…`);
      const API_BASE = 'https://videodownloderbackend.onrender.com';
      // 🔴 REPLACE WITH YOUR PC IP
      const res = await axios.post(`${API_BASE}/extract`, {
        url: instagramUrl,
        quality: quality,
      });

      console.log(res.data);

      const { videoUrl, title, thumbnail } = res.data;

      if (!videoUrl) {
        setStatus('Video not available in this quality');
        return;
      }

      setTitle(title || 'Instagram Video');
      setThumbnail(thumbnail || null);
      setStatus(`Downloading ${quality}p…`);

      const filePath =
        RNFS.ExternalStorageDirectoryPath +
        `/Download/insta_${quality}p_${Date.now()}.mp4`;

      // ✅ DOWNLOAD FILE
      await RNFS.downloadFile({
        fromUrl: videoUrl,
        toFile: filePath,
        progressDivider: 1,
        progress: data => {
          if (data.contentLength > 0) {
            const percent = Math.floor(
              (data.bytesWritten / data.contentLength) * 100,
            );
            setProgress(percent);
          }
        },
      }).promise;

      setProgress(100);
      setStatus('Download completed ✔');

      // ✅ SAVE TO GALLERY (SAFE + MODERN)
      try {
        await CameraRoll.saveAsset(filePath, {
          type: 'video',
          album: 'VideoDownloader',
        });
        setStatus('Download completed ✔ Added to Gallery');
      } catch (galleryErr) {
        console.log('Gallery save failed:', galleryErr);
        setStatus('Download completed ✔ (Check Gallery permission)');
      }
    } catch (err) {
      console.log('Download error:', err);
      setStatus('Download failed ❌');
    }
  };

  // ---------------- UI ----------------
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Video Downloader</Text>

      <View style={styles.card}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.thumbnail} />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <Text style={styles.placeholderText}>Thumbnail</Text>
          </View>
        )}

        <Text style={styles.title}>{title || 'No video yet'}</Text>
        <Text style={styles.status}>{status}</Text>

        {/* QUALITY SELECTOR */}
        <View style={styles.qualityRow}>
          {[480, 720, 1080].map(q => (
            <TouchableOpacity
              key={q}
              style={[styles.qualityBtn, quality === q && styles.qualityActive]}
              onPress={() => setQuality(q)}
            >
              <Text style={styles.qualityText}>{q}p</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* PROGRESS */}
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>

        <Text style={styles.percent}>{progress}%</Text>
      </View>
    </View>
  );
}

// ---------------- STYLES ----------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    padding: 16,
  },
  header: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
  },
  thumbnail: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
  },
  thumbnailPlaceholder: {
    height: 200,
    backgroundColor: '#2c2c2c',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: 12,
  },
  placeholderText: {
    color: '#888',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  status: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 10,
  },
  qualityRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 14,
  },
  qualityBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#333',
  },
  qualityActive: {
    backgroundColor: '#ff2c55',
  },
  qualityText: {
    color: '#fff',
    fontWeight: '600',
  },
  progressBg: {
    height: 8,
    backgroundColor: '#333',
    borderRadius: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#ff2c55',
  },
  percent: {
    marginTop: 8,
    color: '#fff',
    fontSize: 12,
    textAlign: 'right',
  },
});
