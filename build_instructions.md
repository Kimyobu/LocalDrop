# 🚀 LocalDrop Build Instructions
(คู่มือการสร้างไฟล์สำหรับติดตั้งและใช้งานจริง)

เอกสารนี้รวบรวมคำสั่งและขั้นตอนในการ Build โปรเจค LocalDrop สำหรับ 3 แพลตฟอร์มหลัก: **Windows (.exe)**, **Linux (.AppImage)**, และ **Android (.apk)**

---

## 💻 1. Desktop Application (Windows & Linux)
จัดการผ่านโฟลเดอร์ `desktop/` ซึ่งใช้ Electron + electron-builder

### การเตรียมความพร้อม (Setup)
```bash
cd desktop
npm install
```

### 🪟 สำหรับ Windows (.exe)
สร้างตัวติดตั้ง (Installer) สำหรับ Windows
- **คำสั่ง:**
  ```bash
  npm run package -- --win
  ```
- **ผลลัพธ์:** ไฟล์จะอยู่ที่ `desktop/dist/LocalDrop-Setup-[version].exe`
- **หมายเหตุ:** ต้องรันบน Windows หรือใช้ Docker สำหรับ Cross-platform build

### 🐧 สำหรับ Linux (.AppImage)
สร้างไฟล์ Portable สำหรับ Linux (ไม่ต้องติดตั้ง)
- **คำสั่ง:**
  ```bash
  npm run package -- --linux
  ```
- **ผลลัพธ์:** ไฟล์จะอยู่ที่ `desktop/dist/LocalDrop-[version].AppImage`
- **การใช้งาน:**
  1. คลิกขวาที่ไฟล์ -> Properties -> Permissions -> ติ๊กถูกที่ "Allow executing file as program"
  2. หรือสั่งผ่าน Terminal: `chmod +x LocalDrop.AppImage && ./LocalDrop.AppImage`
  3. *หมายเหตุ:* บน Ubuntu รุ่นใหม่ๆ อาจต้องลง `sudo apt install libfuse2` เพื่อรัน AppImage

---

## 📱 2. Mobile Application (Android)
จัดการผ่านโฟลเดอร์ `mobile/` ซึ่งใช้ Expo

### การเตรียมความพร้อม (Setup)
```bash
cd mobile
npm install
```

### 🤖 สำหรับ Android (.apk)
มี 2 วิธีหลักในการสร้างไฟล์:

#### วิธีที่ 1: ผ่าน Cloud (EAS Build) - ง่ายที่สุด 🌟
ใช้ Server ของ Expo ในการ Build (ไม่กินทรัพยากรเครื่องเรา)
1. ติดตั้ง EAS CLI: `npm install -g eas-cli`
2. Login เข้า Expo Account: `eas login`
3. รันคำสั่ง Build:
   ```bash
   eas build -p android --profile preview
   ```
4. รอจนเสร็จ แล้วกด Link ที่ได้เพื่อโหลดไฟล์ `.apk`

#### วิธีที่ 2: Build บนเครื่องตัวเอง (Local Build)
ต้องมี Android Studio และ SDK ติดตั้งอยู่ในเครื่อง
- **คำสั่ง:**
  ```bash
  npx expo run:android --variant release
  ```
- **ผลลัพธ์:** ไฟล์จะอยู่ที่ `mobile/android/app/build/outputs/apk/release/app-release.apk`

---

## 🛠️ สรุปคำสั่งลัด (Cheat Sheet)
| Platform | Format | Folder | Command |
| :--- | :--- | :--- | :--- |
| **Windows** | `.exe` | `desktop/` | `npm run package -- --win` |
| **Linux** | `.AppImage` | `desktop/` | `npm run package -- --linux` |
| **Android** | `.apk` | `mobile/` | `eas build -p android --profile preview` |

---
*จัดทำโดย Antigravity AI Assistant*
