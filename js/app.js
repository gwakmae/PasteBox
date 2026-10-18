function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
}

function updateStatus() {
    const count = app.dataService.getAll().length;
    const syncText = app.githubSync
        ? app.githubSync.getStatusText()
        : '로컬 저장';
    document.getElementById('status-text').textContent =
        `${count}개 | ${syncText}`;
}

function copyRichHtml(html) {
    return new Promise((resolve) => {
        const textarea = document.createElement('textarea');
        textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
        textarea.value = ' ';
        document.body.appendChild(textarea);
        textarea.select();

        function onCopy(e) {
            e.preventDefault();
            e.clipboardData.setData('text/html', html);
            const parsed = new DOMParser().parseFromString(html, 'text/html');
            parsed.querySelectorAll('script, style').forEach(node => node.remove());
            e.clipboardData.setData('text/plain', parsed.body.textContent || '');
        }

        document.addEventListener('copy', onCopy);
        let success = false;
        try {
            success = document.execCommand('copy');
        } catch (err) {
            console.error('[copyRichHtml] error:', err);
        }
        document.removeEventListener('copy', onCopy);
        document.body.removeChild(textarea);
        resolve(success);
    });
}

const app = {
    dataService: null,
    cardListView: null,
    modalView: null,
    githubSync: null,

    init() {
        this.dataService = new DataService();
        this.dataService.init();

        this.cardListView = new CardListView(this.dataService);
        this.modalView = new ModalView(this.dataService);

        this.cardListView.onEdit = (id) => {
            this.modalView.open(id);
        };

        this.modalView.onSave = () => {
            this.renderCards();
            updateStatus();
        };

        this.githubSync = new GitHubSync(this.dataService, {
            onStatus: () => updateStatus(),
            onReload: () => {
                this.renderCards();
                updateStatus();
            }
        });

        this.setupToolbar();
        this.renderCards();
        updateStatus();
    },

    setupToolbar() {
        document.getElementById('btn-github-connect').addEventListener('click', () => {
            this.githubSync.openConnectionDialog();
        });

        document.getElementById('btn-github-save').addEventListener('click', () => {
            this.githubSync.push();
        });

        document.getElementById('btn-github-load').addEventListener('click', () => {
            this.githubSync.pull();
        });

        document.getElementById('btn-github-disconnect').addEventListener('click', () => {
            this.githubSync.disconnect();
        });

        document.getElementById('btn-add').addEventListener('click', () => {
            this.modalView.open();
        });

        document.getElementById('btn-export').addEventListener('click', () => {
            this.dataService.exportJSON();
            showToast('Exported!', 'success');
        });

        document.getElementById('btn-import').addEventListener('click', () => {
            document.getElementById('import-file').click();
        });

        document.getElementById('import-file').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const count = await this.dataService.importJSON(file);
                this.renderCards();
                updateStatus();
                showToast(`Imported ${count} items`, 'success');
            } catch (err) {
                showToast('Import failed: ' + err.message, 'error');
            }
            e.target.value = '';
        });
    },

    renderCards() {
        const container = document.getElementById('card-container');
        this.cardListView.render(container);
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());