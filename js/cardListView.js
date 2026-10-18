class CardListView {
    constructor(dataService) {
        this.dataService = dataService;
        this.onEdit = null;
        this.container = null;
        this.dragItem = null;
        this.dragOverItem = null;
    }

    render(container) {
        this.container = container;
        const items = this.dataService.getAll();

        if (items.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📋</div>
                    <div class="empty-text">No items yet</div>
                    <div class="empty-hint">Click <strong>+ Add</strong> to create your first paste item</div>
                </div>
            `;
            return;
        }

        let html = '<div class="card-list" id="card-list">';
        items.forEach((item, index) => {
            const typeInfo = PasteTypeColors[item.type] || PasteTypeColors[PasteType.TEXT];
            const typeLabel = PasteTypeLabels[item.type] || 'Text';
            const hasTitle = item.title && item.title.trim();
            const preview = this.getPreview(item);

            html += `
                <div class="paste-card" data-id="${item.id}" data-index="${index}" draggable="true">
                    <div class="paste-card-drag-handle" title="Drag to reorder">⠿</div>
                    <div class="paste-card-body">
                        <div class="paste-card-main" data-id="${item.id}">
                            ${hasTitle ? `<div class="paste-card-title">${this.escapeHtml(item.title)}</div>` : ''}
                            <div class="paste-card-preview ${hasTitle ? '' : 'paste-card-preview-large'}">${preview}</div>
                        </div>
                        <div class="paste-card-footer">
                            <span class="paste-card-type" style="background:${typeInfo.bg};color:${typeInfo.text};border:1px solid ${typeInfo.border};">${typeLabel}</span>
                            <div class="paste-card-actions">
                                <button class="card-btn card-btn-edit" data-id="${item.id}" title="Edit">✏️</button>
                                <button class="card-btn card-btn-delete" data-id="${item.id}" title="Delete">🗑️</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;

        this.bindCardEvents(container);
        this.bindDragEvents();
    }

    bindCardEvents(container) {
        container.querySelectorAll('.paste-card-main').forEach(el => {
            el.addEventListener('click', (e) => {
                this.copyItem(el.dataset.id);
            });
        });

        container.querySelectorAll('.card-btn-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.onEdit) this.onEdit(btn.dataset.id);
            });
        });

        container.querySelectorAll('.card-btn-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const item = this.dataService.getById(id);
                const label = item.title || item.value.substring(0, 30);
                if (confirm(`Delete "${label}"?`)) {
                    this.dataService.remove(id);
                    this.render(this.container);
                    showToast('Deleted', 'info');
                    updateStatus();
                }
            });
        });
    }

    bindDragEvents() {
        const cards = document.querySelectorAll('.paste-card');

        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                this.dragItem = card;
                card.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                setTimeout(() => {
                    card.style.opacity = '0.4';
                }, 0);
            });

            card.addEventListener('dragend', (e) => {
                card.classList.remove('dragging');
                card.style.opacity = '';
                this.dragItem = null;
                this.dragOverItem = null;
                document.querySelectorAll('.paste-card').forEach(c => {
                    c.classList.remove('drag-over-top', 'drag-over-bottom');
                });
            });

            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (card === this.dragItem) return;

                const rect = card.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const isAbove = e.clientY < midY;

                document.querySelectorAll('.paste-card').forEach(c => {
                    c.classList.remove('drag-over-top', 'drag-over-bottom');
                });

                if (isAbove) {
                    card.classList.add('drag-over-top');
                } else {
                    card.classList.add('drag-over-bottom');
                }

                this.dragOverItem = card;
            });

            card.addEventListener('dragleave', (e) => {
                card.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            card.addEventListener('drop', (e) => {
                e.preventDefault();
                if (!this.dragItem || card === this.dragItem) return;

                const fromIndex = parseInt(this.dragItem.dataset.index);
                let toIndex = parseInt(card.dataset.index);

                const rect = card.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const isAbove = e.clientY < midY;

                if (fromIndex < toIndex && isAbove) {
                    toIndex = Math.max(0, toIndex - 1);
                } else if (fromIndex > toIndex && !isAbove) {
                    toIndex = toIndex + 1;
                }

                if (fromIndex !== toIndex) {
                    this.dataService.reorder(fromIndex, toIndex);
                    this.render(this.container);
                    showToast('Reordered', 'info');
                }

                document.querySelectorAll('.paste-card').forEach(c => {
                    c.classList.remove('drag-over-top', 'drag-over-bottom');
                });
            });
        });
    }

    getPreview(item) {
        if (item.type === PasteType.HTML) {
            return '<span class="preview-html-badge">Rich HTML Content</span>';
        }
        if (item.type === PasteType.TEMPLATE) {
            const highlighted = this.escapeHtml(item.value.replace(/\n/g, ' '))
                .replace(/\{\{([^}]+)\}\}/g, '<span class="preview-template-var">{{$1}}</span>');
            if (item.value.length > 120) {
                const truncated = this.escapeHtml(item.value.substring(0, 120).replace(/\n/g, ' '))
                    .replace(/\{\{([^}]+)\}\}/g, '<span class="preview-template-var">{{$1}}</span>');
                return truncated + '…';
            }
            return highlighted;
        }
        // text
        const text = item.value.replace(/\n/g, ' ');
        if (text.length > 120) {
            return this.escapeHtml(text.substring(0, 120)) + '…';
        }
        return this.escapeHtml(text);
    }

    async copyItem(id) {
        const item = this.dataService.getById(id);
        if (!item) return;

        // Template: show variable input popup
        if (item.type === PasteType.TEMPLATE) {
            this.showTemplatePopup(item);
            return;
        }

        try {
            if (item.type === PasteType.HTML) {
                const ok = await copyRichHtml(item.value);
                if (ok) {
                    showToast('Copied rich HTML!', 'success');
                } else {
                    throw new Error('Rich copy failed');
                }
            } else {
                await navigator.clipboard.writeText(item.value);
                showToast('Copied!', 'success');
            }

            this.flashCard(id);
        } catch (err) {
            const textarea = document.createElement('textarea');
            textarea.value = item.value;
            textarea.style.cssText = 'position:fixed;left:-9999px;';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('Copied (fallback)', 'success');
        }
    }

    showTemplatePopup(item) {
        // Extract variables
        const varRegex = /\{\{([^}]+)\}\}/g;
        const vars = [];
        let match;
        while ((match = varRegex.exec(item.value)) !== null) {
            if (!vars.includes(match[1])) {
                vars.push(match[1]);
            }
        }

        if (vars.length === 0) {
            // No variables, just copy as text
            navigator.clipboard.writeText(item.value).then(() => {
                showToast('Copied!', 'success');
                this.flashCard(item.id);
            });
            return;
        }

        // Build popup
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        let fieldsHtml = '';
        vars.forEach((v, i) => {
            fieldsHtml += `
                <div class="field-group">
                    <label class="field-label">${this.escapeHtml(v)}</label>
                    <input class="field-input template-var-input" type="text" data-var="${this.escapeHtml(v)}" placeholder="${this.escapeHtml(v)}" ${i === 0 ? 'autofocus' : ''}>
                </div>
            `;
        });

        // Preview with highlighted vars
        const previewHtml = this.escapeHtml(item.value)
            .replace(/\n/g, '<br>')
            .replace(/\{\{([^}]+)\}\}/g, '<span class="preview-template-var">{{$1}}</span>');

        overlay.innerHTML = `
            <div class="modal" style="width:480px;">
                <div class="modal-header">
                    <h2 class="modal-title">Fill Template: ${this.escapeHtml(item.title || 'Untitled')}</h2>
                    <button class="modal-close" id="tpl-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="template-preview-box">${previewHtml}</div>
                    ${fieldsHtml}
                    <div class="field-group">
                        <label class="field-label">Result</label>
                        <div class="template-result-box" id="tpl-result">${this.escapeHtml(item.value)}</div>
                    </div>
                </div>
                <div class="modal-footer">
                    <span class="modal-shortcut-hint">Ctrl+Enter to copy</span>
                    <button class="btn btn-secondary" id="tpl-cancel">Cancel</button>
                    <button class="btn btn-primary" id="tpl-copy" style="background:var(--success);">Copy Result</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const updateResult = () => {
            let result = item.value;
            overlay.querySelectorAll('.template-var-input').forEach(input => {
                const varName = input.dataset.var;
                const val = input.value || `{{${varName}}}`;
                result = result.replaceAll(`{{${varName}}}`, val);
            });
            const resultBox = document.getElementById('tpl-result');
            if (resultBox) {
                resultBox.innerHTML = this.escapeHtml(result).replace(/\n/g, '<br>');
                resultBox._rawValue = result;
            }
        };

        const doCopy = async () => {
            const resultBox = document.getElementById('tpl-result');
            const result = resultBox?._rawValue || item.value;
            try {
                await navigator.clipboard.writeText(result);
                showToast('Template copied!', 'success');
                this.flashCard(item.id);
            } catch (err) {
                const textarea = document.createElement('textarea');
                textarea.value = result;
                textarea.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast('Template copied (fallback)', 'success');
            }
            closePopup();
        };

        const closePopup = () => {
            document.removeEventListener('keydown', keyHandler);
            overlay.classList.add('modal-closing');
            setTimeout(() => overlay.remove(), 200);
        };

        const keyHandler = (e) => {
            if (e.key === 'Escape') closePopup();
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                doCopy();
            }
        };

        // Events
        overlay.querySelectorAll('.template-var-input').forEach(input => {
            input.addEventListener('input', updateResult);
        });
        overlay.querySelector('#tpl-copy').addEventListener('click', doCopy);
        overlay.querySelector('#tpl-cancel').addEventListener('click', closePopup);
        overlay.querySelector('#tpl-close').addEventListener('click', closePopup);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closePopup();
        });
        document.addEventListener('keydown', keyHandler);

        // Initial result
        updateResult();

        // Focus first input
        setTimeout(() => overlay.querySelector('.template-var-input')?.focus(), 100);
    }

    flashCard(id) {
        const card = document.querySelector(`.paste-card[data-id="${id}"]`);
        if (card) {
            card.classList.add('paste-card-copied');
            setTimeout(() => card.classList.remove('paste-card-copied'), 600);
        }
    }

    escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
