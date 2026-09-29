console.info("[Memos] Panel loaded v0.2.4 with Image Lightbox & Permission Guard");

class MemosPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._memos = [];
    this._user = null;
    this._defaultVisibility = "PROTECTED";
    this._currentVisibility = "PROTECTED";
    this._loading = true;
    this._submitting = false;
    this._error = null;
    this._draftContent = "";
    this._editingMemoName = null;
    this._selectedFiles = [];
    this._lightboxImageUrl = null;
  }

  connectedCallback() {
    this._onKeyDownGlobal = (e) => {
      if (e.key === "Escape" && this._lightboxImageUrl) {
        this._closeLightbox();
      }
    };
    window.addEventListener("keydown", this._onKeyDownGlobal);
  }

  disconnectedCallback() {
    if (this._onKeyDownGlobal) {
      window.removeEventListener("keydown", this._onKeyDownGlobal);
    }
  }

  _openLightbox(src) {
    this._lightboxImageUrl = src;
    this._render();
  }

  _closeLightbox() {
    this._lightboxImageUrl = null;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      this._initialized = true;
      this._fetchFeed();
    }
  }

  async _fetchFeed() {
    this._loading = true;
    this._error = null;
    this._render();

    try {
      const response = await this._hass.fetchWithAuth("/api/memos/feed");
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      this._memos = data.memos || [];
      this._host = data.host || "";
      this._user = data.user || null;
      if (data.default_visibility) {
        this._defaultVisibility = data.default_visibility;
        if (!this._editingMemoName) {
          this._currentVisibility = this._defaultVisibility;
        }
      }
    } catch (err) {
      this._error = err.message || "메모를 불러오는데 실패했습니다.";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _startEditMemo(name) {
    const memo = this._memos.find((m) => m.name === name);
    if (!memo) return;

    // Convert any legacy <br> back to pure newlines
    let clean = (memo.content || "").replace(/<br\s*[\/]?>/gi, "\n");

    this._editingMemoName = name;
    this._draftContent = clean;
    this._currentVisibility = memo.visibility || this._defaultVisibility;
    this._render();

    // Scroll smoothly to top editor and focus
    this.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => {
      const inputEl = this.shadowRoot.getElementById("composer-input");
      if (inputEl) {
        inputEl.focus();
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      }
    }, 50);
  }

  _cancelEdit() {
    this._editingMemoName = null;
    this._draftContent = "";
    this._currentVisibility = this._defaultVisibility;
    this._render();
  }

  async _handleComposerSubmit() {
    const inputEl = this.shadowRoot.getElementById("composer-input");
    const content = inputEl ? inputEl.value.trim() : "";
    const hasFiles = this._selectedFiles && this._selectedFiles.length > 0;
    if ((!content && !hasFiles) || this._submitting) return;

    if (this._editingMemoName) {
      await this._submitUpdateMemo(this._editingMemoName, content);
    } else {
      await this._submitCreateMemo(content);
    }
  }

  async _submitCreateMemo(content) {
    this._submitting = true;
    const saveBtn = this.shadowRoot.getElementById("save-btn");
    const hasFiles = this._selectedFiles && this._selectedFiles.length > 0;

    if (saveBtn) {
      saveBtn.innerText = hasFiles ? "사진 업로드 중..." : "저장 중...";
      saveBtn.disabled = true;
    }

    try {
      const uploadedResourceNames = [];

      // 1. Upload attached images first if any
      if (hasFiles) {
        for (let i = 0; i < this._selectedFiles.length; i++) {
          const file = this._selectedFiles[i];
          if (saveBtn) {
            saveBtn.innerText = `사진 업로드 (${i + 1}/${this._selectedFiles.length})...`;
          }

          // Convert file to base64
          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = reader.result;
              const b64 = typeof res === "string" && res.includes(",") ? res.split(",")[1] : res;
              resolve(b64);
            };
            reader.onerror = () => reject(new Error("파일 읽기 실패"));
            reader.readAsDataURL(file);
          });

          const uploadResp = await this._hass.fetchWithAuth("/api/memos/upload", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filename: file.name,
              content_type: file.type || "image/png",
              data: base64Data,
            }),
          });

          if (!uploadResp.ok) {
            let errorMsg = `사진 업로드 실패 (${uploadResp.status})`;
            try {
              const errJson = await uploadResp.json();
              if (errJson && errJson.error) {
                errorMsg = errJson.error;
              }
            } catch (_) {}
            throw new Error(errorMsg);
          }

          const uploadData = await uploadResp.json();
          if (uploadData.error) {
            throw new Error(uploadData.error);
          }

          if (uploadData.resource) {
            const res = uploadData.resource;
            const rName = res.name || (res.id || res.uid ? `resources/${res.id || res.uid}` : null);
            if (rName) {
              uploadedResourceNames.push(rName);
            }
          }
        }
      }

      if (saveBtn) saveBtn.innerText = "메모 저장 중...";

      // 2. Create memo with content and resource_names
      const response = await this._hass.fetchWithAuth("/api/memos/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          visibility: this._currentVisibility,
          resource_names: uploadedResourceNames,
        }),
      });

      if (!response.ok) {
        throw new Error(`저장 실패 (${response.status})`);
      }

      const resData = await response.json();
      if (resData.error) {
        throw new Error(resData.error);
      }

      // Cleanup preview URLs
      for (const f of this._selectedFiles) {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      }

      this._draftContent = "";
      this._selectedFiles = [];
      this._currentVisibility = this._defaultVisibility;
      await this._fetchFeed();
    } catch (err) {
      alert(`메모 저장 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      this._submitting = false;
      const btn = this.shadowRoot.getElementById("save-btn");
      if (btn) {
        btn.innerText = "저장";
        btn.disabled = false;
      }
    }
  }

  async _submitUpdateMemo(name, content) {
    this._submitting = true;
    const saveBtn = this.shadowRoot.getElementById("save-btn");
    if (saveBtn) {
      saveBtn.innerText = "수정 중...";
      saveBtn.disabled = true;
    }

    try {
      const response = await this._hass.fetchWithAuth("/api/memos/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content, visibility: this._currentVisibility }),
      });

      if (!response.ok) {
        throw new Error(`수정 실패 (${response.status})`);
      }

      const resData = await response.json();
      if (resData.error) {
        throw new Error(resData.error);
      }

      this._editingMemoName = null;
      this._draftContent = "";
      this._currentVisibility = this._defaultVisibility;
      await this._fetchFeed();
    } catch (err) {
      alert(`메모 수정 중 오류: ${err.message}`);
    } finally {
      this._submitting = false;
      const btn = this.shadowRoot.getElementById("save-btn");
      if (btn) {
        btn.innerText = this._editingMemoName ? "수정 완료" : "저장";
        btn.disabled = false;
      }
    }
  }

  async _handleDeleteMemo(name) {
    if (!confirm("정말 이 메모를 삭제하시겠습니까?")) return;

    try {
      const response = await this._hass.fetchWithAuth("/api/memos/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        throw new Error(`삭제 실패 (${response.status})`);
      }

      const resData = await response.json();
      if (resData.error) {
        throw new Error(resData.error);
      }

      if (this._editingMemoName === name) {
        this._cancelEdit();
      }

      this._memos = this._memos.filter((m) => m.name !== name);
      this._render();
    } catch (err) {
      alert(`메모 삭제 중 오류: ${err.message}`);
    }
  }

  async _toggleTask(name, lineIndex) {
    const memo = this._memos.find((m) => m.name === name);
    if (!memo) return;

    // Guard: Only allow author or admin to toggle tasks
    const creatorUsername = (memo.creator || "").replace(/^users\//, "");
    const myUsername = this._user ? (this._user.username || "") : "";
    const isMe = Boolean(
      this._user && (
        (memo.creator && memo.creator === this._user.name) ||
        (creatorUsername && creatorUsername === myUsername)
      )
    );
    const isAdmin = Boolean(
      this._user && (this._user.role === "ADMIN" || this._user.role === "HOST")
    );
    if (!isMe && !isAdmin) {
      alert("작성자 본인만 체크박스를 변경할 수 있습니다.");
      return;
    }

    const originalContent = memo.content || "";

    // Split lines by newline
    const lines = originalContent.replace(/<br\s*[\/]?>/gi, "\n").split("\n");
    if (lineIndex < 0 || lineIndex >= lines.length) return;

    const targetLine = lines[lineIndex];
    if (/^(\s*[-*]\s+\[)\s(\]\s*.*)$/.test(targetLine)) {
      lines[lineIndex] = targetLine.replace(/^(\s*[-*]\s+\[)\s(\]\s*.*)$/, "$1x$2");
    } else if (/^(\s*[-*]\s+\[)[xX](\]\s*.*)$/.test(targetLine)) {
      lines[lineIndex] = targetLine.replace(/^(\s*[-*]\s+\[)[xX](\]\s*.*)$/, "$1 $2");
    } else {
      return;
    }

    const newContent = lines.join("\n");
    memo.content = newContent;
    this._render(); // Immediate visual update

    try {
      const response = await this._hass.fetchWithAuth("/api/memos/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: newContent }),
      });
      if (!response.ok) {
        throw new Error(`서버 응답 오류 (${response.status})`);
      }
      const resData = await response.json();
      if (resData.error) {
        throw new Error(resData.error);
      }
    } catch (err) {
      console.error("Failed to toggle checkbox:", err);
      alert(`체크박스 변경에 실패했습니다 (권한 없음 또는 서버 오류):\n${err.message}`);
      memo.content = originalContent;
      this._render();
    }
  }

  _formatDate(isoString) {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const weekday = weekdays[date.getDay()];
      return `${month}월 ${day}일 (${weekday})`;
    } catch {
      return "";
    }
  }

  _renderVisibilityBadge(visibility) {
    if (visibility === "PROTECTED") {
      return `<span class="vis-badge protected" title="멤버 공개">👥 멤버</span>`;
    }
    if (visibility === "PUBLIC") {
      return `<span class="vis-badge public" title="전체 공개">🌐 전체</span>`;
    }
    return `<span class="vis-badge private" title="나만 보기">🔒 비공개</span>`;
  }

  /**
   * Safe and robust Markdown parser for Memos
   */
  _renderMarkdown(text, memoName = "", canManage = false) {
    if (!text) return "";

    // 1. Normalize all <br> variations into standard newlines
    let cleanText = text.replace(/<br\s*[\/]?>/gi, "\n");

    // 2. Remove markdown image syntax (images rendered in gallery below)
    cleanText = cleanText.replace(/!\[.*?\]\([^\s)]+\)/g, "");

    // 3. Escape HTML
    let escaped = cleanText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const rawLines = escaped.split("\n");
    const parsedLines = [];

    let isFirstLine = true;
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const trimmed = line.trim();

      // Checkbox lines (- [ ] or - [x] or * [ ] or * [x])
      if (/^[-*]\s+\[\s\]\s+(.*)$/.test(trimmed)) {
        const itemText = trimmed.replace(/^[-*]\s+\[\s\]\s+/, "");
        const clickClass = canManage ? "clickable" : "readonly";
        const titleText = canManage ? "클릭하여 완료 토글" : "작성자만 체크박스를 변경할 수 있습니다";
        parsedLines.push(
          `<div class="task-line ${clickClass}" ${canManage ? `data-memo="${memoName}" data-line="${i}"` : ""} title="${titleText}"><span class="task-checkbox unchecked"></span><span>${this._formatInline(itemText)}</span></div>`
        );
        isFirstLine = false;
        continue;
      }
      if (/^[-*]\s+\[[xX]\]\s+(.*)$/.test(trimmed)) {
        const itemText = trimmed.replace(/^[-*]\s+\[[xX]\]\s+/, "");
        const clickClass = canManage ? "clickable" : "readonly";
        const titleText = canManage ? "클릭하여 미완료 토글" : "작성자만 체크박스를 변경할 수 있습니다";
        parsedLines.push(
          `<div class="task-line checked ${clickClass}" ${canManage ? `data-memo="${memoName}" data-line="${i}"` : ""} title="${titleText}"><span class="task-checkbox checked">✓</span><span class="task-text-done">${this._formatInline(itemText)}</span></div>`
        );
        isFirstLine = false;
        continue;
      }

      // Headings (#, ##, ###, ####)
      if (/^####\s+(.*)$/.test(trimmed)) {
        parsedLines.push(`<h4>${this._formatInline(trimmed.replace(/^####\s+/, ""))}</h4>`);
        isFirstLine = false;
        continue;
      }
      if (/^###\s+(.*)$/.test(trimmed)) {
        parsedLines.push(`<h3>${this._formatInline(trimmed.replace(/^###\s+/, ""))}</h3>`);
        isFirstLine = false;
        continue;
      }
      if (/^##\s+(.*)$/.test(trimmed)) {
        parsedLines.push(`<h2>${this._formatInline(trimmed.replace(/^##\s+/, ""))}</h2>`);
        isFirstLine = false;
        continue;
      }
      if (/^#\s+(.*)$/.test(trimmed)) {
        parsedLines.push(`<h1>${this._formatInline(trimmed.replace(/^#\s+/, ""))}</h1>`);
        isFirstLine = false;
        continue;
      }

      // Unordered lists
      if (/^[-*]\s+(.*)$/.test(trimmed)) {
        parsedLines.push(`<div class="bullet-line"><span class="bullet">•</span><span>${this._formatInline(trimmed.replace(/^[-*]\s+/, ""))}</span></div>`);
        isFirstLine = false;
        continue;
      }

      // Numbered lists
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        parsedLines.push(`<div class="bullet-line"><span class="num">${numMatch[1]}.</span><span>${this._formatInline(numMatch[2])}</span></div>`);
        isFirstLine = false;
        continue;
      }

      // Horizontal rule
      if (/^---+$/.test(trimmed)) {
        parsedLines.push(`<hr class="memo-hr" />`);
        isFirstLine = false;
        continue;
      }

      // Regular line
      if (trimmed === "") {
        parsedLines.push(`<div class="empty-line"></div>`);
      } else {
        // If first line has no explicit heading syntax, make it bold title like Memos!
        if (isFirstLine) {
          parsedLines.push(`<div class="memo-auto-title">${this._formatInline(line)}</div>`);
        } else {
          parsedLines.push(`<div class="text-line">${this._formatInline(line)}</div>`);
        }
      }
      isFirstLine = false;
    }

    return parsedLines.join("");
  }

  _formatInline(text) {
    return text
      .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/~~(.*?)~~/g, "<del>$1</del>")
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="memo-link">$1</a>')
      .replace(/(^|\s)#([a-zA-Z0-9_\uac00-\ud7a3]+)/g, '$1<span class="tag-badge">#$2</span>');
  }

  _autoResizeTextarea(inputEl) {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    inputEl.style.height = Math.max(72, inputEl.scrollHeight) + "px";
  }

  _insertMarkdown(prefix, suffix = "") {
    const inputEl = this.shadowRoot.getElementById("composer-input");
    if (!inputEl) return;

    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const val = inputEl.value;
    const selected = val.substring(start, end);

    let newStart = start;
    let newEnd = end;

    if (/^#{1,6}\s$/.test(prefix)) {
      // Specific Heading Level (# , ## , ### )
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = val.indexOf("\n", start);
      if (lineEnd === -1) lineEnd = val.length;
      const currentLine = val.substring(lineStart, lineEnd);

      const existingMatch = currentLine.match(/^#{1,6}\s+/);
      if (existingMatch) {
        const cleanLine = currentLine.substring(existingMatch[0].length);
        if (existingMatch[0] === prefix) {
          // Same heading level clicked -> toggle off (remove heading)
          inputEl.value = val.substring(0, lineStart) + cleanLine + val.substring(lineEnd);
          newStart = Math.max(lineStart, start - existingMatch[0].length);
          newEnd = Math.max(lineStart, end - existingMatch[0].length);
        } else {
          // Different heading level -> replace heading
          inputEl.value = val.substring(0, lineStart) + prefix + cleanLine + val.substring(lineEnd);
          const diff = prefix.length - existingMatch[0].length;
          newStart = Math.max(lineStart, start + diff);
          newEnd = Math.max(lineStart, end + diff);
        }
      } else {
        // No heading -> add heading at start of current line
        inputEl.value = val.substring(0, lineStart) + prefix + currentLine + val.substring(lineEnd);
        newStart = start + prefix.length;
        newEnd = end + prefix.length;
      }
    } else if (prefix === "- [ ] ") {
      // Find beginning of current line to insert at line start
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      const currentLine = val.substring(lineStart, start);
      if (/^[-*]\s+\[[\sxX]\]\s*/.test(currentLine)) {
        inputEl.focus();
        return;
      }
      inputEl.value = val.substring(0, lineStart) + "- [ ] " + val.substring(lineStart);
      newStart = newEnd = start + 6;
    } else if (prefix === "#") {
      inputEl.value = val.substring(0, start) + "#" + (selected || "태그") + " " + val.substring(end);
      newStart = start + 1;
      newEnd = selected ? newStart + selected.length : newStart + 2;
    } else {
      const placeholder = selected || (prefix === "`" ? "코드" : "내용");
      inputEl.value = val.substring(0, start) + prefix + placeholder + suffix + val.substring(end);
      newStart = start + prefix.length;
      newEnd = newStart + placeholder.length;
    }

    this._draftContent = inputEl.value;
    inputEl.focus();
    inputEl.setSelectionRange(newStart, newEnd);
    this._autoResizeTextarea(inputEl);
  }

  _handleSmartKey(e, inputEl) {
    // 1. Submit on Ctrl+Enter / Cmd+Enter
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      this._handleComposerSubmit();
      return;
    }

    // 2. 2-Space indentation on Tab
    if (e.key === "Tab") {
      e.preventDefault();
      const start = inputEl.selectionStart;
      const end = inputEl.selectionEnd;
      const val = inputEl.value;
      inputEl.value = val.substring(0, start) + "  " + val.substring(end);
      inputEl.selectionStart = inputEl.selectionEnd = start + 2;
      this._draftContent = inputEl.value;
      return;
    }

    // 3. Smart list continuation & auto-exit on clean Enter
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const val = inputEl.value;
      const selStart = inputEl.selectionStart;
      const lineStart = val.lastIndexOf("\n", selStart - 1) + 1;
      let lineEnd = val.indexOf("\n", selStart);
      if (lineEnd === -1) lineEnd = val.length;

      const currentLine = val.substring(lineStart, lineEnd);

      // Checkbox list: - [ ] or - [x] or * [ ] or * [x]
      const taskMatch = currentLine.match(/^(\s*[-*]\s+\[[\sxX]\]\s*)(.*)$/);
      if (taskMatch) {
        e.preventDefault();
        const prefix = taskMatch[1];
        const content = taskMatch[2];
        if (content.trim() === "") {
          // Empty item -> exit list
          inputEl.value = val.substring(0, lineStart) + val.substring(lineEnd);
          inputEl.selectionStart = inputEl.selectionEnd = lineStart;
        } else {
          // Continue checkbox list
          const indent = prefix.match(/^\s*/)[0];
          const continuation = "\n" + indent + "- [ ] ";
          inputEl.value = val.substring(0, selStart) + continuation + val.substring(selStart);
          inputEl.selectionStart = inputEl.selectionEnd = selStart + continuation.length;
        }
        this._draftContent = inputEl.value;
        this._autoResizeTextarea(inputEl);
        return;
      }

      // Bullet list: - or *
      const bulletMatch = currentLine.match(/^(\s*[-*]\s+)(.*)$/);
      if (bulletMatch) {
        e.preventDefault();
        const prefix = bulletMatch[1];
        const content = bulletMatch[2];
        if (content.trim() === "") {
          // Empty bullet -> exit list
          inputEl.value = val.substring(0, lineStart) + val.substring(lineEnd);
          inputEl.selectionStart = inputEl.selectionEnd = lineStart;
        } else {
          // Continue bullet list
          const indent = prefix.match(/^\s*/)[0];
          const continuation = "\n" + indent + "- ";
          inputEl.value = val.substring(0, selStart) + continuation + val.substring(selStart);
          inputEl.selectionStart = inputEl.selectionEnd = selStart + continuation.length;
        }
        this._draftContent = inputEl.value;
        this._autoResizeTextarea(inputEl);
        return;
      }

      // Numbered list: 1. 
      const numMatch = currentLine.match(/^(\s*)(\d+)\.\s+(.*)$/);
      if (numMatch) {
        e.preventDefault();
        const indent = numMatch[1];
        const currentNum = parseInt(numMatch[2], 10);
        const content = numMatch[3];
        if (content.trim() === "") {
          // Empty numbered item -> exit list
          inputEl.value = val.substring(0, lineStart) + val.substring(lineEnd);
          inputEl.selectionStart = inputEl.selectionEnd = lineStart;
        } else {
          const continuation = `\n${indent}${currentNum + 1}. `;
          inputEl.value = val.substring(0, selStart) + continuation + val.substring(selStart);
          inputEl.selectionStart = inputEl.selectionEnd = selStart + continuation.length;
        }
        this._draftContent = inputEl.value;
        this._autoResizeTextarea(inputEl);
        return;
      }
    }
  }

  _render() {
    const shadow = this.shadowRoot;
    const isEditing = Boolean(this._editingMemoName);
    const prevScrollTop = this.scrollTop;

    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          height: 100vh;
          background-color: var(--primary-background-color, #111113);
          color: var(--primary-text-color, #ffffff);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          overflow-y: auto;
          box-sizing: border-box;
        }

        .header {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          background-color: var(--app-header-background-color, var(--card-background-color, #1a1a1e));
          border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        }

        .header-title-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .menu-btn, .refresh-btn {
          background: none;
          border: none;
          color: var(--primary-text-color, #ffffff);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px;
          border-radius: 50%;
          transition: background-color 0.2s;
        }

        .menu-btn:hover, .refresh-btn:hover {
          background-color: rgba(255, 255, 255, 0.1);
        }

        .title {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }

        .header-user {
          font-size: 13px;
          color: var(--secondary-text-color, #909098);
          font-weight: 500;
          background-color: rgba(255, 255, 255, 0.08);
          padding: 2px 9px;
          border-radius: 12px;
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
        }

        .feed-container {
          max-width: 720px;
          margin: 0 auto;
          padding: 20px 16px 80px 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* Composer Card */
        .composer-card {
          background-color: var(--card-background-color, #1c1c20);
          border: 1px solid ${isEditing ? "var(--primary-color, #0288d1)" : "var(--divider-color, rgba(255, 255, 255, 0.1))"};
          border-radius: 12px;
          padding: 14px 16px;
          box-shadow: ${isEditing ? "0 0 0 1px var(--primary-color, #0288d1), 0 6px 16px rgba(0, 0, 0, 0.3)" : "0 4px 12px rgba(0, 0, 0, 0.2)"};
          display: flex;
          flex-direction: column;
          gap: 10px;
          transition: all 0.2s ease;
        }

        .composer-card:focus-within {
          border-color: var(--primary-color, #0288d1);
        }

        .composer-edit-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 8px;
          border-bottom: 1px dashed var(--divider-color, rgba(255, 255, 255, 0.12));
        }

        .edit-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-color, #29b6f6);
        }

        .composer-textarea {
          width: 100%;
          background: transparent;
          border: none;
          color: var(--primary-text-color, #ffffff);
          font-size: 15px;
          line-height: 1.6;
          font-family: inherit;
          resize: none;
          min-height: 72px;
          outline: none;
          box-sizing: border-box;
          overflow-y: hidden;
        }

        .composer-textarea::placeholder {
          color: var(--secondary-text-color, #707078);
        }

        .composer-toolbar {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 6px 0 2px 0;
          border-top: 1px solid var(--divider-color, rgba(255, 255, 255, 0.05));
        }

        .toolbar-btn {
          background: none;
          border: none;
          color: var(--secondary-text-color, #888892);
          cursor: pointer;
          padding: 5px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .toolbar-btn.text-btn {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 6px;
          min-width: 24px;
          font-family: inherit;
          letter-spacing: -0.5px;
        }

        .toolbar-btn:hover {
          color: var(--primary-color, #29b6f6);
          background-color: rgba(255, 255, 255, 0.08);
        }

        .toolbar-btn svg {
          width: 17px;
          height: 17px;
        }

        .toolbar-divider {
          width: 1px;
          height: 14px;
          background-color: var(--divider-color, rgba(255, 255, 255, 0.1));
          margin: 0 4px;
        }

        .composer-attachments-preview {
          display: flex;
          gap: 8px;
          padding: 8px 0 4px 0;
          overflow-x: auto;
        }

        .preview-thumb-wrap {
          position: relative;
          width: 58px;
          height: 58px;
          flex-shrink: 0;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background-color: rgba(0, 0, 0, 0.3);
        }

        .preview-thumb-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          cursor: zoom-in;
          transition: transform 0.15s ease;
        }

        .preview-thumb-img:hover {
          transform: scale(1.05);
        }

        .preview-thumb-del {
          position: absolute;
          top: 2px;
          right: 2px;
          background: rgba(0, 0, 0, 0.7);
          color: #ffffff;
          border: none;
          border-radius: 50%;
          width: 18px;
          height: 18px;
          font-size: 12px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background-color 0.15s;
          padding: 0;
        }

        .preview-thumb-del:hover {
          background-color: #ff5252;
        }

        .composer-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-top: 1px solid var(--divider-color, rgba(255, 255, 255, 0.06));
          padding-top: 10px;
          gap: 12px;
          flex-wrap: wrap;
        }

        .composer-actions-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .visibility-select {
          background-color: rgba(255, 255, 255, 0.08);
          color: var(--primary-text-color, #ffffff);
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.14));
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 12px;
          font-weight: 500;
          outline: none;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .visibility-select:hover {
          background-color: rgba(255, 255, 255, 0.12);
          border-color: var(--primary-color, #0288d1);
        }

        .visibility-select option {
          background-color: #202024;
          color: #ffffff;
        }

        .composer-hint {
          font-size: 12px;
          color: var(--secondary-text-color, #707078);
        }

        .btn-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .save-btn {
          background-color: var(--primary-color, #0288d1);
          color: #ffffff;
          border: none;
          border-radius: 8px;
          padding: 7px 18px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s;
        }

        .btn-cancel {
          background-color: transparent;
          color: var(--secondary-text-color, #909098);
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.15));
          border-radius: 8px;
          padding: 6px 14px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .btn-cancel:hover {
          background-color: rgba(255, 255, 255, 0.08);
          color: var(--primary-text-color, #ffffff);
        }

        .save-btn:hover {
          opacity: 0.9;
        }

        .save-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .status-msg {
          text-align: center;
          padding: 40px 20px;
          color: var(--secondary-text-color, #88888e);
          font-size: 15px;
        }

        /* Memo Card */
        .memo-card {
          background-color: var(--card-background-color, #1c1c20);
          border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
          border-radius: 12px;
          padding: 16px 20px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
          transition: border-color 0.15s;
          position: relative;
        }

        .memo-card:hover {
          border-color: rgba(255, 255, 255, 0.18);
        }

        .memo-card.editing-target {
          border: 1px dashed var(--primary-color, #0288d1);
          background-color: rgba(2, 136, 209, 0.04);
        }

        .memo-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        .memo-header-left {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .memo-author {
          font-size: 13px;
          font-weight: 600;
          color: #81c784;
        }

        .memo-author.is-me {
          color: var(--primary-color, #29b6f6);
        }

        .memo-dot {
          color: var(--secondary-text-color, #606068);
          font-size: 11px;
        }

        .memo-date {
          font-size: 13px;
          color: var(--secondary-text-color, #909098);
          font-weight: 500;
        }

        .vis-badge {
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 4px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          line-height: 1.4;
        }

        .vis-badge.protected {
          background-color: rgba(33, 150, 243, 0.14);
          color: #42a5f5;
        }

        .vis-badge.public {
          background-color: rgba(76, 175, 80, 0.14);
          color: #66bb6a;
        }

        .vis-badge.private {
          background-color: rgba(255, 255, 255, 0.08);
          color: var(--secondary-text-color, #909098);
        }

        .editing-label {
          font-size: 11px;
          color: var(--primary-color, #29b6f6);
          background-color: rgba(2, 136, 209, 0.15);
          padding: 1px 6px;
          border-radius: 4px;
          font-weight: 600;
        }

        .memo-tools {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .icon-btn {
          background: none;
          border: none;
          color: var(--secondary-text-color, #808088);
          cursor: pointer;
          padding: 5px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s, background-color 0.15s;
        }

        .icon-btn:hover {
          color: var(--primary-text-color, #ffffff);
          background-color: rgba(255, 255, 255, 0.08);
        }

        .icon-btn.danger:hover {
          color: #ff5252;
          background-color: rgba(255, 82, 82, 0.1);
        }

        .memo-content {
          font-size: 15px;
          line-height: 1.6;
          color: var(--primary-text-color, #e2e2e6);
          word-break: break-word;
        }

        .memo-auto-title {
          font-size: 17px;
          font-weight: 700;
          line-height: 1.4;
          margin-bottom: 6px;
          color: var(--primary-text-color, #ffffff);
        }

        /* Markdown Styles */
        h1, h2, h3, h4 {
          margin: 12px 0 6px 0;
          color: var(--primary-text-color, #ffffff);
          line-height: 1.35;
          font-weight: 700;
        }

        h1:first-child, h2:first-child, h3:first-child, h4:first-child {
          margin-top: 0;
        }

        h1 { font-size: 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 4px; }
        h2 { font-size: 18px; }
        h3 { font-size: 16px; }
        h4 { font-size: 15px; }

        .text-line { min-height: 22px; }
        .empty-line { height: 10px; }

        .bullet-line {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          margin: 2px 0;
        }

        .bullet-line .bullet, .bullet-line .num {
          color: var(--secondary-text-color, #888892);
          font-weight: 600;
          user-select: none;
        }

        .task-line {
          display: flex;
          gap: 10px;
          align-items: center;
          margin: 4px 0;
        }

        .task-line.clickable {
          cursor: pointer;
          user-select: none;
          border-radius: 6px;
          padding: 2px 6px;
          margin: 2px -6px;
          transition: background-color 0.15s ease;
        }

        .task-line.clickable:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }

        .task-line.clickable:hover .task-checkbox:not(.checked) {
          border-color: var(--primary-color, #0288d1);
        }

        .task-line.readonly {
          cursor: default;
          user-select: text;
        }

        .task-line.readonly .task-checkbox {
          cursor: default;
          opacity: 0.65;
        }

        .task-checkbox {
          width: 17px;
          height: 17px;
          border-radius: 4px;
          border: 2px solid var(--secondary-text-color, #707078);
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          flex-shrink: 0;
        }

        .task-checkbox.checked {
          background-color: var(--primary-color, #0288d1);
          border-color: var(--primary-color, #0288d1);
          color: #ffffff;
        }

        .task-text-done {
          text-decoration: line-through;
          color: var(--secondary-text-color, #787882);
        }

        .tag-badge {
          background-color: rgba(2, 136, 209, 0.15);
          color: var(--primary-color, #29b6f6);
          border-radius: 6px;
          padding: 2px 7px;
          font-size: 12px;
          font-weight: 600;
          display: inline-block;
          margin: 0 2px;
        }

        .inline-code {
          background-color: rgba(255, 255, 255, 0.08);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: Consolas, monospace;
          font-size: 13px;
        }

        .memo-link {
          color: var(--primary-color, #29b6f6);
          text-decoration: none;
        }

        .memo-link:hover { text-decoration: underline; }

        .memo-hr {
          border: none;
          border-top: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
          margin: 12px 0;
        }

        .memo-images {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 10px;
          margin-top: 14px;
        }

        .memo-img {
          width: 100%;
          max-height: 340px;
          object-fit: cover;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background-color: rgba(0, 0, 0, 0.2);
          cursor: zoom-in;
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .memo-img:hover {
          transform: scale(1.02);
          border-color: rgba(255, 255, 255, 0.35);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
        }

        /* Fullscreen Lightbox Modal */
        .lightbox-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 99999;
          background-color: rgba(10, 10, 14, 0.88);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: lightboxFadeIn 0.2s ease-out forwards;
          cursor: zoom-out;
          padding: 24px;
          box-sizing: border-box;
        }

        @keyframes lightboxFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .lightbox-container {
          position: relative;
          max-width: 92vw;
          max-height: 90vh;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: lightboxPopIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          cursor: default;
        }

        @keyframes lightboxPopIn {
          from {
            transform: scale(0.92);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }

        .lightbox-img {
          max-width: 92vw;
          max-height: 88vh;
          object-fit: contain;
          border-radius: 8px;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.75);
          display: block;
          user-select: none;
        }

        .lightbox-close-btn {
          position: fixed;
          top: 20px;
          right: 24px;
          z-index: 100000;
          background: rgba(30, 30, 36, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.25);
          color: #ffffff;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
          transition: all 0.18s ease;
        }

        .lightbox-close-btn:hover {
          background-color: #ef4444;
          border-color: #ef4444;
          transform: scale(1.1);
        }

        .lightbox-close-btn svg {
          width: 22px;
          height: 22px;
          fill: currentColor;
        }

        svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
        }

        .header svg {
          width: 22px;
          height: 22px;
        }
      </style>

      <div class="header">
        <div class="header-title-wrap">
          <button class="menu-btn" id="menu-btn" title="Menu">
            <svg viewBox="0 0 24 24"><path d="M3,6H21V8H3V6M3,11H21V13H3V11M3,16H21V18H3V16Z"/></svg>
          </button>
          <span class="title">Memos</span>
          ${
            this._user && (this._user.displayName || this._user.username)
              ? `<span class="header-user">@${this._user.displayName || this._user.username}</span>`
              : ""
          }
        </div>
        <button class="refresh-btn" id="refresh-btn" title="Refresh">
          <svg viewBox="0 0 24 24"><path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z"/></svg>
        </button>
      </div>

      <div class="feed-container">
        <!-- Top Composer Card (Dual mode: Create & Edit) -->
        <div class="composer-card">
          ${
            isEditing
              ? `
              <div class="composer-edit-banner">
                <span class="edit-badge">
                  <svg viewBox="0 0 24 24"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/></svg>
                  메모 수정 중
                </span>
                <button class="btn-cancel" id="cancel-edit-btn-top">취소</button>
              </div>
              `
              : ""
          }

          <textarea
            class="composer-textarea"
            id="composer-input"
            placeholder="${isEditing ? '메모 내용을 수정하세요...' : '떠오르는 생각을 적어보세요... (Ctrl + Enter로 저장)'}"
          ></textarea>

          ${
            this._selectedFiles && this._selectedFiles.length > 0
              ? `
              <div class="composer-attachments-preview">
                ${this._selectedFiles
                  .map(
                    (file, idx) => `
                    <div class="preview-thumb-wrap" title="${file.name}">
                      <img class="preview-thumb-img" src="${file.previewUrl}" alt="${file.name}" />
                      <button class="preview-thumb-del" data-idx="${idx}" title="삭제">×</button>
                    </div>
                  `
                  )
                  .join("")}
              </div>
              `
              : ""
          }

          <input type="file" id="image-file-input" accept="image/*" multiple style="display:none;" />

          <div class="composer-toolbar">
            <button class="toolbar-btn text-btn" id="tb-h1" title="대제목 (# )">#</button>
            <button class="toolbar-btn text-btn" id="tb-h2" title="중제목 (## )">##</button>
            <button class="toolbar-btn text-btn" id="tb-h3" title="소제목 (### )">###</button>
            <div class="toolbar-divider"></div>
            <button class="toolbar-btn" id="tb-checkbox" title="체크리스트 추가 (- [ ])">
              <svg viewBox="0 0 24 24"><path d="M19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M19,5V19H5V5H19M10,17L5,12L6.41,10.59L10,14.17L17.59,6.58L19,8L10,17Z"/></svg>
            </button>
            <button class="toolbar-btn" id="tb-tag" title="태그 추가 (#)">
              <svg viewBox="0 0 24 24"><path d="M5.41,21L6.12,17H2.12L2.47,15H6.47L7.18,11H3.18L3.53,9H7.53L8.24,5H10.24L9.53,9H13.53L14.24,5H16.24L15.53,9H19.53L19.18,11H15.18L14.47,15H18.47L18.12,17H14.12L13.41,21H11.41L12.12,17H8.12L7.41,21H5.41M9.88,15H13.88L14.59,11H10.59L9.88,15Z"/></svg>
            </button>
            <button class="toolbar-btn" id="tb-bold" title="굵게 (**)">
              <svg viewBox="0 0 24 24"><path d="M13.5,15.5H10V12.5H13.5A1.5,1.5 0 0,0 15,11A1.5,1.5 0 0,0 13.5,9.5H10V6.5H13.5A3.5,3.5 0 0,1 17,10A3.5,3.5 0 0,1 13.5,13.5H13.5A3.5,3.5 0 0,1 17,17A3.5,3.5 0 0,1 13.5,20.5H8V6.5H10V15.5H13.5A1.5,1.5 0 0,0 15,17A1.5,1.5 0 0,0 13.5,15.5Z"/></svg>
            </button>
            <button class="toolbar-btn" id="tb-italic" title="기울임 (*)">
              <svg viewBox="0 0 24 24"><path d="M10,4V7H12.21L8.79,15H6V18H14V15H11.79L15.21,7H18V4H10Z"/></svg>
            </button>
            <button class="toolbar-btn" id="tb-code" title="코드 (인라인/블록)">
              <svg viewBox="0 0 24 24"><path d="M14.6,16.6L19.2,12L14.6,7.4L16,6L22,12L16,18L14.6,16.6M9.4,16.6L4.8,12L9.4,7.4L8,6L2,12L8,18L9.4,16.6Z"/></svg>
            </button>
            <button class="toolbar-btn" id="tb-link" title="링크 추가">
              <svg viewBox="0 0 24 24"><path d="M3.9,12C3.9,10.29 5.29,8.9 7,8.9H11V7H7A5,5 0 0,0 2,12A5,5 0 0,0 7,17H11V15.1H7C5.29,15.1 3.9,13.71 3.9,12M8,13H16V11H8V13M17,7H13V8.9H17C18.71,8.9 20.1,10.29 20.1,12C20.1,13.71 18.71,15.1 17,15.1H13V17H17A5,5 0 0,0 22,12A5,5 0 0,0 17,7Z"/></svg>
            </button>
            <div class="toolbar-divider"></div>
            <button class="toolbar-btn" id="tb-image" title="사진/이미지 첨부">
              <svg viewBox="0 0 24 24"><path d="M19,19H5V5H19M19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M13.96,12.29L11.21,15.83L9.25,13.47L6.5,17H17.5L13.96,12.29Z"/></svg>
            </button>
          </div>

          <div class="composer-actions">
            <div class="composer-actions-left">
              <select class="visibility-select" id="composer-visibility" title="공개 범위 선택">
                <option value="PRIVATE" ${this._currentVisibility === "PRIVATE" ? "selected" : ""}>🔒 나만 보기</option>
                <option value="PROTECTED" ${this._currentVisibility === "PROTECTED" ? "selected" : ""}>👥 멤버 공개</option>
                <option value="PUBLIC" ${this._currentVisibility === "PUBLIC" ? "selected" : ""}>🌐 전체 공개</option>
              </select>
              <span class="composer-hint">Ctrl + Enter: ${isEditing ? "수정 완료" : "저장"}</span>
            </div>
            <div class="btn-group">
              ${isEditing ? `<button class="btn-cancel" id="cancel-edit-btn">취소</button>` : ""}
              <button class="save-btn" id="save-btn">${isEditing ? "수정 완료" : "저장"}</button>
            </div>
          </div>
        </div>

        <!-- Memos Feed -->
        ${
          this._loading
            ? `<div class="status-msg">메모를 불러오는 중...</div>`
            : this._error
            ? `<div class="status-msg" style="color: #ff5252;">${this._error}</div>`
            : this._memos.length === 0
            ? `<div class="status-msg">등록된 메모가 없습니다. 첫 메모를 작성해 보세요!</div>`
            : this._memos
                .map((memo) => this._renderMemoCard(memo))
                .join("")
        }
      </div>

      ${
        this._lightboxImageUrl
          ? `
          <div class="lightbox-overlay" id="lightbox-overlay" title="클릭 시 닫기">
            <button class="lightbox-close-btn" id="lightbox-close-btn" title="닫기 (ESC)">
              <svg viewBox="0 0 24 24"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>
            </button>
            <div class="lightbox-container" id="lightbox-container">
              <img class="lightbox-img" id="lightbox-img" src="${this._lightboxImageUrl}" alt="확대 이미지" />
            </div>
          </div>
          `
          : ""
      }
    `;

    // Direct property assignment for textarea value guarantees zero HTML escaping/newline corruption!
    const inputEl = shadow.getElementById("composer-input");
    if (inputEl) {
      inputEl.value = this._draftContent;

      inputEl.oninput = (e) => {
        this._draftContent = e.target.value;
        this._autoResizeTextarea(inputEl);
      };

      inputEl.onkeydown = (e) => this._handleSmartKey(e, inputEl);
      this._autoResizeTextarea(inputEl);
    }

    // Toolbar buttons
    const tbH1 = shadow.getElementById("tb-h1");
    if (tbH1) tbH1.onclick = () => this._insertMarkdown("# ");

    const tbH2 = shadow.getElementById("tb-h2");
    if (tbH2) tbH2.onclick = () => this._insertMarkdown("## ");

    const tbH3 = shadow.getElementById("tb-h3");
    if (tbH3) tbH3.onclick = () => this._insertMarkdown("### ");

    const tbCheckbox = shadow.getElementById("tb-checkbox");
    if (tbCheckbox) tbCheckbox.onclick = () => this._insertMarkdown("- [ ] ");

    const tbTag = shadow.getElementById("tb-tag");
    if (tbTag) tbTag.onclick = () => this._insertMarkdown("#");

    const tbBold = shadow.getElementById("tb-bold");
    if (tbBold) tbBold.onclick = () => this._insertMarkdown("**", "**");

    const tbItalic = shadow.getElementById("tb-italic");
    if (tbItalic) tbItalic.onclick = () => this._insertMarkdown("*", "*");

    const tbCode = shadow.getElementById("tb-code");
    if (tbCode) tbCode.onclick = () => this._insertMarkdown("`", "`");

    const tbLink = shadow.getElementById("tb-link");
    if (tbLink) tbLink.onclick = () => this._insertMarkdown("[", "](https://)");

    // Image file selection listeners
    const imageInput = shadow.getElementById("image-file-input");
    const tbImage = shadow.getElementById("tb-image");
    if (tbImage && imageInput) {
      tbImage.onclick = () => imageInput.click();
    }
    if (imageInput) {
      imageInput.onchange = (e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
          file.previewUrl = URL.createObjectURL(file);
          this._selectedFiles.push(file);
        }
        imageInput.value = "";
        this._render();
      };
    }

    // Attach listeners for deleting attached preview
    shadow.querySelectorAll(".preview-thumb-del").forEach((delBtn) => {
      delBtn.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(delBtn.getAttribute("data-idx"), 10);
        if (!isNaN(idx) && idx >= 0 && idx < this._selectedFiles.length) {
          const removed = this._selectedFiles.splice(idx, 1)[0];
          if (removed && removed.previewUrl) {
            URL.revokeObjectURL(removed.previewUrl);
          }
          this._render();
        }
      };
    });

    // Visibility select change
    const visSelect = shadow.getElementById("composer-visibility");
    if (visSelect) {
      visSelect.onchange = (e) => {
        this._currentVisibility = e.target.value;
      };
    }

    // Event listeners
    const refreshBtn = shadow.getElementById("refresh-btn");
    if (refreshBtn) refreshBtn.onclick = () => this._fetchFeed();

    const menuBtn = shadow.getElementById("menu-btn");
    if (menuBtn) {
      menuBtn.onclick = () => {
        const event = new CustomEvent("hass-toggle-menu", {
          bubbles: true,
          composed: true,
        });
        this.dispatchEvent(event);
      };
    }

    const saveBtn = shadow.getElementById("save-btn");
    if (saveBtn) saveBtn.onclick = () => this._handleComposerSubmit();

    const cancelTop = shadow.getElementById("cancel-edit-btn-top");
    if (cancelTop) cancelTop.onclick = () => this._cancelEdit();

    const cancelBottom = shadow.getElementById("cancel-edit-btn");
    if (cancelBottom) cancelBottom.onclick = () => this._cancelEdit();

    // Attach listeners for Edit & Delete buttons on cards
    shadow.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.onclick = () => {
        const name = btn.getAttribute("data-name");
        this._handleDeleteMemo(name);
      };
    });

    shadow.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.onclick = () => {
        const name = btn.getAttribute("data-name");
        this._startEditMemo(name);
      };
    });

    // Attach listeners for interactive checkboxes
    shadow.querySelectorAll(".task-line.clickable").forEach((lineEl) => {
      lineEl.onclick = (e) => {
        if (e.target.tagName === "A") return;
        const memoName = lineEl.getAttribute("data-memo");
        const lineIdx = parseInt(lineEl.getAttribute("data-line"), 10);
        if (memoName && !isNaN(lineIdx)) {
          this._toggleTask(memoName, lineIdx);
        }
      };
    });

    // Image click -> Lightbox Modal
    shadow.querySelectorAll(".memo-img").forEach((img) => {
      img.onclick = (e) => {
        e.stopPropagation();
        this._openLightbox(img.src);
      };
    });

    shadow.querySelectorAll(".preview-thumb-img").forEach((img) => {
      img.onclick = (e) => {
        e.stopPropagation();
        this._openLightbox(img.src);
      };
    });

    // Lightbox close interactions
    const lightboxCloseBtn = shadow.getElementById("lightbox-close-btn");
    const lightboxOverlay = shadow.getElementById("lightbox-overlay");
    const lightboxContainer = shadow.getElementById("lightbox-container");

    if (lightboxCloseBtn) {
      lightboxCloseBtn.onclick = (e) => {
        e.stopPropagation();
        this._closeLightbox();
      };
    }

    if (lightboxOverlay) {
      lightboxOverlay.onclick = (e) => {
        this._closeLightbox();
      };
    }

    if (lightboxContainer) {
      lightboxContainer.onclick = (e) => {
        e.stopPropagation();
      };
    }

    const lightboxImg = shadow.getElementById("lightbox-img");
    if (lightboxImg) {
      lightboxImg.onclick = (e) => {
        e.stopPropagation();
      };
    }

    // Restore scroll position
    this.scrollTop = prevScrollTop;
  }

  _renderMemoCard(memo) {
    const rawContent = (memo.content || "").trim();
    if (!rawContent && (!memo.attachments || memo.attachments.length === 0)) {
      return "";
    }

    const dateStr = this._formatDate(memo.createTime);
    const isTarget = this._editingMemoName === memo.name;

    // Author check
    const creatorUsername = (memo.creator || "").replace(/^users\//, "");
    const myUsername = this._user ? (this._user.username || "") : "";
    const isMe = Boolean(
      this._user && (
        (memo.creator && memo.creator === this._user.name) ||
        (creatorUsername && creatorUsername === myUsername)
      )
    );
    const isAdmin = Boolean(
      this._user && (this._user.role === "ADMIN" || this._user.role === "HOST")
    );
    const canManage = isMe || isAdmin;

    const authorDisplay = isMe
      ? `@${creatorUsername || myUsername || "나"} (나)`
      : `@${creatorUsername || "멤버"}`;

    // Collect images
    const images = [];
    if (Array.isArray(memo.attachments)) {
      for (const att of memo.attachments) {
        if (att.externalLink) {
          images.push(att.externalLink);
        } else if (att.name) {
          const fn = att.filename ? `&filename=${encodeURIComponent(att.filename)}` : "";
          images.push(`/api/memos/attachment?path=${encodeURIComponent(att.name)}${fn}`);
        }
      }
    }

    const mdImgRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
    let match;
    while ((match = mdImgRegex.exec(rawContent)) !== null) {
      images.push(match[1]);
    }

    return `
      <div class="memo-card ${isTarget ? "editing-target" : ""}">
        <div class="memo-header">
          <div class="memo-header-left">
            <span class="memo-author ${isMe ? "is-me" : "other"}">${authorDisplay}</span>
            <span class="memo-dot">·</span>
            <span class="memo-date">${dateStr || "메모"}</span>
            ${this._renderVisibilityBadge(memo.visibility)}
            ${isTarget ? `<span class="editing-label">수정 중...</span>` : ""}
          </div>
          ${
            canManage
              ? `
              <div class="memo-tools">
                <button class="icon-btn btn-edit" data-name="${memo.name}" title="수정">
                  <svg viewBox="0 0 24 24"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/></svg>
                </button>
                <button class="icon-btn danger btn-delete" data-name="${memo.name}" title="삭제">
                  <svg viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/></svg>
                </button>
              </div>
              `
              : ""
          }
        </div>

        <div class="memo-content">${this._renderMarkdown(rawContent, memo.name, canManage)}</div>

        ${
          images.length > 0
            ? `<div class="memo-images">
                ${images
                  .map(
                    (imgUrl) =>
                      `<img class="memo-img" src="${imgUrl}" loading="lazy" onerror="this.style.display='none'"/>`
                  )
                  .join("")}
               </div>`
            : ""
        }
      </div>
    `;
  }
}

if (!customElements.get("memos-panel")) {
  customElements.define("memos-panel", MemosPanel);
}
