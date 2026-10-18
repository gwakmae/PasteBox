class ModalView {
    constructor(dataService) {
        this.dataService = dataService;
        this.onSave = null;
        this.currentId = null;
        this._keyHandler = null;
    }

    open(id = null) {
        this.currentId = id;
        const item = id ? this.dataService.getById(id) : null;
        const isEdit = !!item;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h2 class="modal-title">${isEdit ? 'Edit Item' : 'Add New Item'}</h2>
                    <button class="modal-close" id="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="field-group">
                        <label class="field-label">Title (optional)</label>
                        <input class="field-input" type="text" id="modal-title" value="${this.escapeAttr(item?.title || '')}" placeholder="e.g., FQR 참석자">
                    </div>
                    <div class="field-group">
                        <label class="field-label">Type</label>
                        <div class="type-selector" id="type-selector">
                            <button class="type-btn ${(!item || item.type === PasteType.TEXT) ? 'active' : ''}" data-type="${PasteType.TEXT}">Text</button>
                            <button class="type-btn ${item?.type === PasteType.HTML ? 'active' : ''}" data-type="${PasteType.HTML}">Rich HTML</button>
                            <button class="type-btn ${item?.type === PasteType.TEMPLATE ? 'active' : ''}" data-type="${PasteType.TEMPLATE}">Template</button>
                        </div>
                    </div>
                    <div class="field-group" id="value-group">
                        <label class="field-label" id="value-label">Content</label>
                        <textarea class="field-input field-input-textarea" id="modal-value" rows="6" placeholder="Type or paste content here...">${this.escapeAttr(item?.value || '')}</textarea>
                    </div>
                    <div class="field-group" id="template-hint-group" style="display:none;">
                        <div class="template-hint-box">
                            Use <code>{{변수명}}</code> for variables. Example:<br>
                            <code>안녕하세요, {{이름}}님. {{날짜}}까지 회신 부탁드립니다.</code>
                        </div>
                    </div>
                    <div class="field-group" id="paste-zone-group" style="display:none;">
                        <label class="field-label">Or paste rich content here (Ctrl+V from Outlook)</label>
                        <div class="paste-zone" id="paste-zone" contenteditable="true">
                            <span class="paste-zone-hint">Click here and Ctrl+V to paste rich content</span>
                        </div>
                        <div class="paste-zone-preview" id="paste-zone-preview" style="display:none;">
                            <div class="field-label" style="margin-bottom:6px;">Preview:</div>
                            <div id="paste-preview-content"></div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <span class="modal-shortcut-hint">Ctrl+Enter to save</span>
                    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
                    <button class="btn btn-primary" id="modal-save">${isEdit ? 'Update' : 'Add'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Close handlers
        overlay.querySelector('#modal-close').addEventListener('click', () => this.close());
        overlay.querySelector('#modal-cancel').addEventListener('click', () => this.close());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.close();
        });

        // Type selector
        overlay.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                overlay.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.updateTypeUI(btn.dataset.type);
            });
        });

        // Paste zone for HTML
        const pasteZone = overlay.querySelector('#paste-zone');
        pasteZone.addEventListener('paste', (e) => {
            e.preventDefault();
            const html = e.clipboardData.getData('text/html');
            const text = e.clipboardData.getData('text/plain');

            if (html) {
                const cleaned = this.cleanPastedHtml(html);
                document.getElementById('modal-value').value = cleaned;
                const preview = document.getElementById('paste-preview-content');
                preview.textContent = cleaned;
                preview.style.whiteSpace = 'pre-wrap';
                preview.style.overflowWrap = 'anywhere';
                preview.style.color = '#111';
                document.getElementById('paste-zone-preview').style.display = 'block';
                pasteZone.innerHTML = '<span class="paste-zone-success">Rich content captured!</span>';

                overlay.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
                overlay.querySelector(`[data-type="${PasteType.HTML}"]`).classList.add('active');
                this.updateTypeUI(PasteType.HTML);
            } else if (text) {
                document.getElementById('modal-value').value = text;
                pasteZone.innerHTML = '<span class="paste-zone-hint">Plain text pasted — switch to Text type if needed</span>';
            }
        });

        // Save
        overlay.querySelector('#modal-save').addEventListener('click', () => this.save());

        // Keyboard
        this._keyHandler = (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.save();
            }
        };
        document.addEventListener('keydown', this._keyHandler);

        // Initial type UI
        const activeType = item?.type || PasteType.TEXT;
        this.updateTypeUI(activeType);

        // If editing HTML, show preview
        if (item?.type === PasteType.HTML && item.value) {
            const preview = document.getElementById('paste-preview-content');
            preview.textContent = item.value;
            preview.style.whiteSpace = 'pre-wrap';
            preview.style.overflowWrap = 'anywhere';
            preview.style.color = '#111';
            document.getElementById('paste-zone-preview').style.display = 'block';
        }

        // Focus title input
        setTimeout(() => document.getElementById('modal-title')?.focus(), 100);
    }

    updateTypeUI(type) {
        const pasteGroup = document.getElementById('paste-zone-group');
        const templateHint = document.getElementById('template-hint-group');
        const valueLabel = document.getElementById('value-label');
        const valueEl = document.getElementById('modal-value');

        pasteGroup.style.display = 'none';
        templateHint.style.display = 'none';

        if (type === PasteType.HTML) {
            pasteGroup.style.display = 'block';
            valueLabel.textContent = 'HTML Code';
            valueEl.placeholder = 'HTML will be captured from paste zone above, or type manually...';
            valueEl.rows = 4;
        } else if (type === PasteType.TEMPLATE) {
            templateHint.style.display = 'block';
            valueLabel.textContent = 'Template Content (use {{변수명}} for variables)';
            valueEl.placeholder = '안녕하세요, {{이름}}님. {{날짜}}까지 회신 부탁드립니다.';
            valueEl.rows = 6;
        } else {
            valueLabel.textContent = 'Content';
            valueEl.placeholder = 'Type your text here...';
            valueEl.rows = 6;
        }
    }

    cleanPastedHtml(html) {
        let cleaned = html;
        const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        if (bodyMatch) {
            cleaned = bodyMatch[1];
        }
        cleaned = cleaned.replace(/<!--StartFragment-->/gi, '').replace(/<!--EndFragment-->/gi, '');
        cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        cleaned = cleaned.replace(/<meta[^>]*>/gi, '');
        cleaned = cleaned.replace(/<link[^>]*>/gi, '');
        cleaned = cleaned.trim();
        return cleaned;
    }

    save() {
        const title = document.getElementById('modal-title').value.trim();
        const value = document.getElementById('modal-value').value.trim();
        const activeType = document.querySelector('.type-btn.active')?.dataset.type || PasteType.TEXT;

        if (!value) {
            showToast('Content is required', 'error');
            return;
        }

        if (this.currentId) {
            this.dataService.update(this.currentId, { title, type: activeType, value });
            showToast('Updated!', 'success');
        } else {
            this.dataService.add({ title, type: activeType, value });
            showToast('Added!', 'success');
        }

        this.close();
        if (this.onSave) this.onSave();
    }

    close() {
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        const overlay = document.querySelector('.modal-overlay');
        if (overlay) {
            overlay.classList.add('modal-closing');
            setTimeout(() => overlay.remove(), 200);
        }
    }

    escapeAttr(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}