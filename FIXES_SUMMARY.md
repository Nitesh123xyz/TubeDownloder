# Bug Fix Summary: RNBackgroundDownloader TypeError

## Problem
```
TypeError: Cannot read property 'download' of undefined
    at ?anon_0_ (Video.jsx:100:51)
```

## Root Cause Analysis

### Issue 1: Incorrect Import
**Problem:** The code was importing the package incorrectly
```jsx
import { RNBackgroundDownloader } from '@kesha-antonov/react-native-background-downloader';
```

**Reason:** The package `@kesha-antonov/react-native-background-downloader` does NOT export a named export called `RNBackgroundDownloader`. Instead, it exports individual named functions.

### Issue 2: Wrong API Usage
**Problem:** The code was trying to call `RNBackgroundDownloader.download()`
```jsx
const task = RNBackgroundDownloader.download({...});
```

**Reason:** The library's actual API uses `createDownloadTask()` function, not a `download()` method on an object. This is why `RNBackgroundDownloader` was `undefined` and calling `.download()` threw an error.

### Issue 3: Missing Progress Callback Parameters
**Problem:** Progress callback was receiving a single number parameter
```jsx
.progress(p => setProgress(Math.floor(p * 100)))
```

**Reason:** The library passes an object with `{ bytesDownloaded, bytesTotal }` properties, not a single percentage number.

### Issue 4: Missing Task Start
**Problem:** The task chain wasn't calling `.start()`
```jsx
// ...no .start() call
```

**Reason:** The `createDownloadTask()` returns a task object that requires explicit `.start()` to begin the download.

### Issue 5: File Path Issue
**Problem:** Using `RNFS.DownloadDirectoryPath` directly
```jsx
const filePath = `${RNFS.DownloadDirectoryPath}/${fileName}`;
```

**Reason:** Should use the library's `directories.documents` property for consistency and to ensure proper path handling.

## Solution Applied

### Changed Import
```jsx
// Before
import { RNBackgroundDownloader } from '@kesha-antonov/react-native-background-downloader';

// After
import { createDownloadTask, directories } from '@kesha-antonov/react-native-background-downloader';
```

### Updated File Path
```jsx
// Before
const filePath = `${RNFS.DownloadDirectoryPath}/${fileName}`;

// After
const filePath = `${directories.documents}/${fileName}`;
```

### Fixed Download Task Creation
```jsx
// Before
const task = RNBackgroundDownloader.download({
  id: `dl_${Date.now()}`,
  url: directUrl,
  destination: filePath,
  notification: { enabled: true, title: vTitle || 'Downloading...' },
});

// After
const task = createDownloadTask({
  id: `dl_${Date.now()}`,
  url: directUrl,
  destination: filePath,
  metadata: { title: vTitle },
});
```

### Updated Progress Callback
```jsx
// Before
.progress(p => setProgress(Math.floor(p * 100)))

// After
.progress(({ bytesDownloaded, bytesTotal }) => setProgress(Math.floor((bytesDownloaded / bytesTotal) * 100)))
```

### Updated Done Callback
```jsx
// Before
.done(async () => {

// After
.done(async ({ bytesDownloaded, bytesTotal }) => {
```

### Fixed Error Callback
```jsx
// Before
.error(e => {
  console.log(e);

// After
.error(({ error, errorCode }) => {
  console.log('Download error:', error, errorCode);
```

### Added Missing Start Call
```jsx
// Added at the end of the task chain
.start();
```

## Files Modified
- `components/Video.jsx` - Fixed import and download API usage

## Additional Notes

### Native Module Linking Status
The package is installed (`@kesha-antonov/react-native-background-downloader` v4.3.8) but requires proper native linking for Android and iOS:

**For React Native 0.77+** (Automatic linking via `autolinkLibrariesFromCommand`)
- Android: Already configured in `settings.gradle` with `ex.autolinkLibrariesFromCommand()`
- iOS: Requires running `pod install`

**For iOS:** Additional setup is required in `AppDelegate.swift` to handle background downloads. See README for details.

### Verification Steps
1. Run `pod install` on iOS to link the native module
2. Rebuild the app: `react-native run-android` or `react-native run-ios`
3. Test the download functionality

## Reference
- Library Docs: https://github.com/kesha-antonov/react-native-background-downloader
- API: Uses `createDownloadTask()` function with chained method API (.begin, .progress, .done, .error, .start)
