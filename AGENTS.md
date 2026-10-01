# Assistant Rules and Communication Guidelines

## 커뮤니케이션 및 작성 스타일 규칙

1. **아이콘 및 이모지 사용 지양**:
   - 답변, 커밋 메시지, 변경 이력 및 릴리즈 노트 등 모든 작성물에서 이모지나 장식용 아이콘(예: ✨, 🚀, 📸, 🔍, 🛡️ 등)을 가급적 사용하지 않습니다.
   - 불필요한 기호 대신 명확한 텍스트와 표준적인 기호(불릿 기호 `-` 등)를 사용합니다.

2. **사람이 작성한 듯한 자연스러운 문체**:
   - 과도하게 형식적이거나 기계적인 번역투, 도식화된 AI 특유의 어조를 지양합니다.
   - 동료 개발자와 편안하고 차분하게 대화하듯 군더더기 없는 자연스러운 어조로 설명합니다.
   - 핵심 내용 위주로 담백하고 명확하게 전달합니다.

## 개발 및 브랜치 배포 워크플로우

1. **개발 및 실서버 테스트 단계**:
   - 코드 수정 후 minipc에 직접 업로드(SCP)하여 실서버 Home Assistant에서 먼저 정상 동작을 검증합니다.
   - 개발 및 중간 테스트 커밋은 `develop` 브랜치에 푸시하여 작업합니다 (`main` 브랜치 직접 커밋 방지).

2. **정식 릴리즈 단계**:
   - 모든 기능 검증과 테스트가 완료되면 `develop` 브랜치를 `main` 브랜치로 병합(Merge)합니다.
   - 정식 버전 번호를 올리고 Git 태그를 생성하여 `main`에 최종 푸시합니다.
   - 릴리즈 노트 작성을 위한 핵심 변경 사항을 사용자에게 정리하여 공유합니다.

## 실서버 테스트 환경 및 배포 명령어

채팅 세션이 초기화되거나 새 대화가 시작되어도 실서버 테스트를 즉시 수행할 수 있도록 서버 환경 정보를 기록합니다.

- **SSH 접속 호스트**: `minipc`
- **호스트 측 Home Assistant 경로**: `/opt/stacks/homeassistant/ha_config/custom_components/memos/`
- **도커 컨테이너 이름**: `homeassistant`
- **컨테이너 내부 경로**: `/config/custom_components/memos/`

### 표준 배포 명령어
코드 수정 후 다음 명령어로 실서버에 반영하고 Home Assistant를 재시작합니다:
```bash
scp -r custom_components/memos minipc:/tmp/memos_update
ssh minipc "docker cp /tmp/memos_update/. homeassistant:/config/custom_components/memos/; docker exec homeassistant chmod -R 755 /config/custom_components/memos; docker exec homeassistant rm -rf /config/custom_components/memos/__pycache__; rm -rf /tmp/memos_update; docker restart homeassistant"
```
