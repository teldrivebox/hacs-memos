# Memos Integration for Home Assistant (HACS)

<p align="center">
  <img src="logo.png" alt="Memos Logo" width="120" />
</p>

<p align="center">
  <a href="https://github.com/hacs/integration"><img src="https://img.shields.io/badge/HACS-Custom-orange.svg" alt="HACS Custom" /></a>
  <a href="https://usememos.com"><img src="https://img.shields.io/badge/Memos-v0.22+-blue.svg" alt="Memos Support" /></a>
  <img src="https://img.shields.io/badge/version-0.1.15-green.svg" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
</p>

<p align="center">
  <b>A lightweight, modern, and seamless Memos (usememos) feed & smart composer integration for Home Assistant.</b><br>
  Home Assistant의 사이드바에서 나만의 마이크로 블로그/메모 서비스 <a href="https://usememos.com">Memos</a>를 가볍고 아름다운 스마트 에디터와 인터랙티브 피드로 사용하세요.
</p>

---

## 🌐 Language / 언어 선택
- [English](#-english)
- [한국어](#-한국어)

---

## 📖 English

### ✨ Features
- **Sidebar Integration**: Automatically creates a dedicated **Memos** panel in the Home Assistant sidebar.
- **Smart Markdown Composer**:
  - **Smart List Continuation**: Typing `- [ ] `, `- `, or `1. ` automatically continues on Enter. Pressing Enter on an empty line cleanly exits the list.
  - **Quick Formatting Toolbar**: Dedicated `#`, `##`, `###` heading buttons (with cyclic toggle/replace), `- [ ]` checklist, `#` tag, `**bold**`, `*italic*`, `inline code`, and `links`.
  - **Tab Key Indentation**: 2-space indentation on Tab without losing focus.
  - **Keyboard Shortcut**: `Ctrl + Enter` (or `Cmd + Enter`) to instantly save or finish editing.
- **Interactive Checklists**: Click `- [ ]` checkboxes directly in feed cards to toggle between pending and completed (`- [x]`) with instant server synchronization.
- **Visibility Control**: Select between **Private (🔒 나만 보기)**, **Protected (👥 멤버 공개)**, or **Public (🌐 전체 공개)**. Automatically detects user defaults from Memos.
- **Multi-user & Permissions**: Displays author badges (`@author`), highlights your own memos, and guards edit/delete operations according to your user role.
- **Photo & Image Gallery**: Supports external markdown links and securely proxies internal attachments.
- **Zero Heavy Bundles**: Built with pure native Web Components inside Shadow DOM for maximum speed and HA theme compatibility.

---

### 📦 Installation

#### Method 1: HACS (Custom Repository)
1. Open **HACS** in your Home Assistant instance.
2. Click the three dots in the top right corner and select **Custom repositories**.
3. Enter your repository URL:
   - **Repository**: `https://github.com/<your-username>/hacs-memos`
   - **Category**: `Integration`
4. Click **Add**, find **Memos**, and click **Download**.
5. Restart Home Assistant.

#### Method 2: Manual Installation
1. Download this repository.
2. Copy the `custom_components/memos` directory into your Home Assistant's `config/custom_components/` folder.
3. Restart Home Assistant.

---

### ⚙️ Configuration
1. In Home Assistant, navigate to **Settings** > **Devices & Services**.
2. Click **Add Integration** and search for **Memos**.
3. Fill in the two fields:
   - **Server URL**: Your Memos instance address (e.g., `https://memos.example.com` or `http://192.168.1.100:5230`)
   - **Personal Access Token**: Generated from Memos Web > *Settings* > *Account* > *Access Tokens*
4. Click Submit. The **Memos** icon will appear on your sidebar immediately!

---

### 🗺️ Roadmap
- [ ] 📎 Upload images and attachments directly from the HA composer
- [ ] 📊 Lovelace Dashboard Card & Sensor entities (`sensor.memos_total_count`, recent memos)
- [ ] 🔔 Notification & Automation service (`memos.create` service call)
- [ ] 🏷️ Tag filtering chips & search

---

## 🇰🇷 한국어

### ✨ 주요 기능
- **사이드바 메뉴 자동 등록**: 복잡한 YAML 설정 없이 통합구성요소 추가만으로 왼쪽 사이드바에 Memos 전용 패널이 자동 생성됩니다.
- **경량 스마트 마크다운 에디터**:
  - **스마트 리스트 자동 연장**: `- [ ] `, `- `, `1. ` 입력 후 Enter를 치면 다음 줄에 자동으로 이어집니다. 빈 줄에서 Enter 입력 시 깔끔하게 목록을 종료합니다.
  - **퀵 서식 툴바**: `#`, `##`, `###` 전용 제목 버튼(레벨 교체 및 토글 해제 지원), `- [ ]` 체크리스트, `#` 태그, `**굵게**`, `*기울임*`, `코드`, `링크` 버튼 탑재.
  - **Tab 들여쓰기**: 에디터 내에서 Tab 키 입력 시 2칸 공백 들여쓰기 지원.
  - **단축키**: `Ctrl + Enter` (또는 `Cmd + Enter`)로 작성 및 수정 완료.
- **인터랙티브 체크박스 클릭 토글**: 피드 카드에 적힌 `- [ ]` 할 일 목록을 클릭하면 즉시 체크(`- [x]`)로 전환되며 Memos 서버에 실시간 동기화됩니다.
- **공개 범위 설정**: **🔒 나만 보기**, **👥 멤버 공개**, **🌐 전체 공개**를 선택할 수 있으며, Memos 계정에 설정된 기본 공개 범위를 자동으로 불러옵니다.
- **다중 사용자 및 권한 보호**: 작성자 표시(`@homeassistant (나)`, `@member`)와 권한에 따른 수정/삭제 버튼 보호(작성자 또는 관리자).
- **이미지 갤러리**: 메모에 첨부된 내부 파일 및 외부 이미지 링크를 반응형 그리드로 안전하게 출력합니다.
- **초경량 웹 컴포넌트**: 외부 무거운 프레임워크 없이 순수 JavaScript와 Shadow DOM으로 제작되어 매우 가볍고 HA 다크/라이트 테마에 완벽히 적응합니다.

---

### 📦 설치 방법

#### 방법 1: HACS 사용자 지정 저장소 등록 (권장)
1. Home Assistant에서 **HACS** 메뉴로 이동합니다.
2. 우측 상단 메뉴(점 3개)를 누르고 **사용자 지정 저장소 (Custom repositories)**를 선택합니다.
3. 저장소 주소를 입력합니다:
   - **저장소 (Repository)**: `https://github.com/<깃허브-아이디>/hacs-memos`
   - **종류 (Category)**: `통합구성요소 (Integration)`
4. **추가**를 클릭한 후, 목록에 나타난 **Memos**를 찾아 **다운로드**를 클릭합니다.
5. Home Assistant를 **재시작**합니다.

#### 방법 2: 수동 설치
1. 본 저장소의 코드를 다운로드합니다.
2. `custom_components/memos` 폴더를 Home Assistant 서버의 `config/custom_components/` 경로 안에 복사합니다.
3. Home Assistant를 **재시작**합니다.

---

### ⚙️ 설정 방법 (단 2가지만 입력)
1. Home Assistant **설정** > **기기 및 서비스** > **통합구성요소 추가**를 클릭합니다.
2. 검색창에 **Memos**를 입력하고 선택합니다.
3. 다음 2가지 정보를 입력합니다:
   - **서버 URL**: 운영 중인 Memos 주소 (예: `https://memos.example.com` 또는 `http://192.168.1.100:5230`)
   - **Personal Access Token**: Memos 웹 > *설정* > *계정* > *Access Tokens* 메뉴에서 발급한 토큰
4. 확인을 누르면 연결 검증이 완료되고, **왼쪽 사이드바에 Memos 아이콘이 즉시 나타납니다!**

---

### 🗺️ 향후 개발 로드맵
- [ ] 📎 HA 에디터에서 이미지 및 파일 직접 업로드 기능
- [ ] 📊 Lovelace 대시보드 카드 및 메모 카운트/최근 메모 센서 (`sensor.memos_*`)
- [ ] 🔔 HA 자동화용 알림 서비스 등록 (`memos.create` 서비스)
- [ ] 🏷️ 태그 칩 필터링 및 실시간 검색 기능

---

## 📄 License
MIT License - 자유롭게 수정 및 배포하실 수 있습니다.
