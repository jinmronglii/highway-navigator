# Taiwan Highway 61/72 Navigation System - APK 編譯指南

## 快速開始

### 方法1：用GitHub Actions自動編譯（推薦）

1. **上傳到GitHub**
   ```bash
   git remote add origin https://github.com/你的帳號/highway-navigator.git
   git branch -M main
   git push -u origin main
   ```

2. **啟用GitHub Actions**
   - 進入GitHub倉庫 → Settings → Actions → General
   - 選擇 "Allow all actions and reusable workflows"

3. **編譯APK**
   - 進入 Actions 標籤
   - 選擇 "Build APK" 工作流程
   - 點擊 "Run workflow"
   - 等待編譯完成（約5-10分鐘）

4. **下載APK**
   - 編譯完成後，進入該次運行
   - 下載 "app-release.apk" 文件

### 方法2：本地編譯（需要Android Studio）

1. **安裝依賴**
   ```bash
   npm install --legacy-peer-deps
   ```

2. **編譯Web應用**
   ```bash
   npm run build
   ```

3. **同步到Android**
   ```bash
   npx cap copy android
   ```

4. **編譯APK**
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

5. **APK位置**
   ```
   android/app/build/outputs/apk/release/app-release.apk
   ```

## 應用信息

- **應用名稱**: Highway Navigator
- **包名**: com.highway.navigator
- **版本**: 1.0
- **最低Android版本**: Android 6.0+

## 功能

- 🎥 街景定位 (台61、台72線)
- 🔄 回轉導航系統
- 📍 GPS定位
- 🗺️ Google Maps整合
- 🎤 語音輸入

## 所需權限

- 位置 (GPS定位)
- 相機 (街景查看)
- 麥克風 (語音輸入)
- 網路 (地圖和街景)

## 簽名設定

編譯release版本需要簽名。如果沒有簽名文件，可以：

1. **生成簽名文件**
   ```bash
   keytool -genkey -v -keystore release.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias release
   ```

2. **在gradle.properties中配置**
   ```properties
   MYAPP_RELEASE_STORE_FILE=release.keystore
   MYAPP_RELEASE_STORE_PASSWORD=你的密碼
   MYAPP_RELEASE_KEY_ALIAS=release
   MYAPP_RELEASE_KEY_PASSWORD=你的密碼
   ```

## 故障排除

### 編譯失敗
- 確保Java版本是11或以上
- 清除gradle快取: `./gradlew clean`
- 重新下載依賴: `npm ci --legacy-peer-deps`

### APK無法安裝
- 確保Android版本 >= 6.0
- 允許來自未知來源的應用安裝

### 功能不正常
- 檢查Google Maps API金鑰
- 確保應用有必要的權限
- 檢查網路連接

## 發佈到Google Play

1. 建立Google Play開發者帳號
2. 準備應用簽名
3. 上傳APK到Google Play Console
4. 填寫應用信息和截圖
5. 提交審核

詳見: https://developer.android.com/studio/publish

## 支援

如有問題，請檢查:
- capacitor.config.ts 配置
- AndroidManifest.xml 權限設定
- build.gradle 依賴版本
