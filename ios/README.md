# แอป iOS ของ AmPayPay (ขึ้น TestFlight โดยไม่ต้องมี Mac)

แอปเป็น `WKWebView` เต็มจอที่เปิด <https://ampaypay.onrender.com> — **อัปเดตเว็บเมื่อไหร่ แอปในเครื่องได้ของใหม่ทันที ไม่ต้องส่งบิลด์ใหม่**
บิลด์ด้วย GitHub Actions (macOS runner) แล้วส่งขึ้น TestFlight อัตโนมัติ

## สิ่งที่ต้องมี

- บัญชี **Apple Developer Program** ($99/ปี)
- สิทธิ์ **App Manager** ขึ้นไปใน App Store Connect (ไว้ให้ Xcode ออกใบรับรองให้เอง)
- ไม่ต้องมี Mac ไม่ต้องมี Xcode ในเครื่อง

---

## ตั้งค่าครั้งเดียว

### 1. สร้าง API Key ของ App Store Connect

<https://appstoreconnect.apple.com> → **Users and Access → Integrations → App Store Connect API → Team Keys** → **+**

- Name: `GitHub Actions`
- Access: **App Manager**
- กด Generate แล้ว **ดาวน์โหลดไฟล์ `.p8`** (โหลดได้ครั้งเดียวเท่านั้น เก็บไว้ให้ดี)
- จดค่าไว้ 2 อย่าง: **Key ID** (เช่น `ABC123XYZ9`) และ **Issuer ID** (รูปแบบ UUID ยาว ๆ)

### 2. หา Team ID

<https://developer.apple.com/account> → **Membership details** → **Team ID** (10 ตัวอักษร เช่น `A1B2C3D4E5`)

### 3. ใส่ค่าลงใน GitHub

รีโปนี้ → **Settings → Secrets and variables → Actions → New repository secret** ใส่ 4 อย่าง

| ชื่อ Secret | ค่าที่ใส่ |
| --- | --- |
| `APPSTORE_KEY_ID` | Key ID จากข้อ 1 |
| `APPSTORE_ISSUER_ID` | Issuer ID จากข้อ 1 |
| `APPSTORE_PRIVATE_KEY` | **เนื้อในไฟล์ `.p8` ทั้งไฟล์** (เปิดด้วย Notepad/TextEdit แล้วคัดลอกทั้งหมด รวมบรรทัด `-----BEGIN PRIVATE KEY-----`) |
| `APPLE_TEAM_ID` | Team ID จากข้อ 2 |

อยากเปลี่ยน Bundle ID จากค่าเริ่มต้น `com.ampaypay.app` → เพิ่ม **Variable** (ไม่ใช่ Secret) ชื่อ `IOS_BUNDLE_ID`

### 4. สร้างแอปใน App Store Connect

<https://appstoreconnect.apple.com/apps> → **+ → New App**

- Platform: iOS · Name: `AmPayPay` · Language: Thai
- Bundle ID: เลือกให้ตรงกับ `com.ampaypay.app` (ถ้ายังไม่มีในรายการ ให้รันเวิร์กโฟลว์รอบแรกก่อน Xcode จะสร้าง Bundle ID ให้เอง แล้วค่อยกลับมาสร้างแอป)
- SKU: อะไรก็ได้ เช่น `ampaypay`

---

## บิลด์และส่งขึ้น TestFlight

รีโปนี้ → แท็บ **Actions** → **iOS → TestFlight** → **Run workflow**

เวิร์กโฟลว์จะ: ติดตั้ง XcodeGen → สร้างไฟล์โปรเจกต์ → ให้ Xcode ออกใบรับรอง/โปรไฟล์ให้อัตโนมัติ → archive → export `.ipa` → ตรวจไฟล์ → อัปขึ้น App Store Connect

- **เลขบิลด์** ใช้เลขรันของ GitHub Actions อัตโนมัติ ไม่ต้องกรอกเอง (ไม่ชนกันแน่นอน)
- ใช้เวลาราว 10–15 นาที เสร็จแล้วรอ Apple ประมวลผลอีก 5–15 นาที
- ถ้าอัปไม่ผ่าน ยังโหลดไฟล์ `.ipa` จาก Artifacts ของรันนั้นมาตรวจได้

## เพิ่มคนทดสอบ

App Store Connect → แอป → **TestFlight**

- **Internal Testing** (ทีมตัวเอง ≤ 100 คน) — **ไม่ต้องผ่าน App Review** เพิ่มอีเมลแล้วทดสอบได้เลย
- **External Testing** (คนนอก ≤ 10,000 คน) — ต้องผ่าน **Beta App Review** ก่อน (ปกติ 1–2 วัน)

> ⚠️ แอปที่เป็นเว็บห่ออาจโดน Guideline **4.2 Minimum Functionality** ตีกลับตอนขอ External หรือตอนขึ้นสโตร์จริง
> ถ้าเจอ ให้เพิ่มความสามารถฝั่ง native เข้าไป เช่น Share Extension รับรูปใบเสร็จจากแอปอื่น, Widget สรุปยอด, หรือแจ้งเตือนแบบ native
> (Internal Testing ไม่เจอปัญหานี้ เพราะไม่ผ่านรีวิว)

---

## โครงไฟล์

| ไฟล์ | หน้าที่ |
| --- | --- |
| `project.yml` | สเปกให้ XcodeGen สร้าง `.xcodeproj` ตอนบิลด์ (จะได้ไม่ต้องเก็บไฟล์โปรเจกต์ที่แก้มือยากไว้ในรีโป) |
| `App/Sources/AppDelegate.swift` | จุดเริ่มแอป สร้างหน้าต่างเดียว |
| `App/Sources/WebViewController.swift` | ตัวแอปจริง — WebView เต็มจอ, กล้อง, alert/confirm/prompt, ลิงก์นอกเปิด Safari, ดึงลงเพื่อรีเฟรช, หน้าจอตอนเน็ตหลุด |
| `App/Resources/Info.plist` | ชื่อแอป, สิทธิ์กล้อง/รูปภาพ (ภาษาไทย), หน้า launch |
| `App/Resources/Assets.xcassets` | ไอคอน 1024 (ไม่มี alpha ตามที่ Apple บังคับ) + สีพื้นหลังตอนเปิดแอป |
| `../.github/workflows/ios-testflight.yml` | บิลด์และอัปขึ้น TestFlight |

## ข้อจำกัดที่ต่างจากฝั่ง Android

| เรื่อง | บน iOS |
| --- | --- |
| แจ้งเตือนแบบ push | **ใช้ไม่ได้** — Web Push ทำงานเฉพาะใน Safari/PWA ที่เพิ่มลงหน้าจอโฮม ไม่ทำงานใน WKWebView ถ้าอยากได้ต้องทำ APNs แบบ native เพิ่ม |
| ข้อมูลในเครื่อง | อยู่ครบ (localStorage/IndexedDB) แต่**คนละที่เก็บกับ Safari** — ข้อมูลในแอปกับในเว็บไม่เห็นกัน ถ้าใช้ทั้งสองทางให้เปิดซิงก์ ☁️ |
| กล้อง / เลือกรูป | ใช้ได้ปกติ (iOS 15+) |
| อัปเดตแอป | เว็บอัปเดตเอง ส่งบิลด์ใหม่เฉพาะตอนเปลี่ยนไอคอน ชื่อแอป สิทธิ์ หรือโค้ด Swift |
