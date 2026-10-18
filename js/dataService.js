class DataService {
    constructor() {
        this.STORAGE_KEY = 'pastebox-items';
        this.items = [];
        this.onChange = null;
    }

    init() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            try {
                this.items = GitHubSync.validateItems(JSON.parse(stored));
                return;
            } catch (e) { /* fall through */ }
        }

        this.items = [];
        this.save();
    }

    save() {
        this.items = GitHubSync.validateItems(this.items);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.items));

        if (typeof this.onChange === 'function') {
            this.onChange();
        }
    }

    getAll() {
        return this.items;
    }

    getById(id) {
        return this.items.find(item => item.id === id);
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    add(item) {
        item.id = this.generateId();
        this.items.push(item);
        this.save();
        return item;
    }

    update(id, updates) {
        const idx = this.items.findIndex(item => item.id === id);
        if (idx !== -1) {
            this.items[idx] = { ...this.items[idx], ...updates };
            this.save();
            return this.items[idx];
        }
        return null;
    }

    remove(id) {
        this.items = this.items.filter(item => item.id !== id);
        this.save();
    }

    reorder(fromIndex, toIndex) {
        const [moved] = this.items.splice(fromIndex, 1);
        this.items.splice(toIndex, 0, moved);
        this.save();
    }

    exportJSON() {
        const blob = new Blob([JSON.stringify(this.items, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pastebox-backup.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    importJSON(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = GitHubSync.validateItems(JSON.parse(e.target.result));
                    if (Array.isArray(data)) {
                        this.items = data;
                        this.save();
                        resolve(data.length);
                    } else {
                        reject(new Error('Invalid format'));
                    }
                } catch (err) {
                    reject(err);
                }
            };
            reader.readAsText(file);
        });
    }

    clearAll() {
        this.items = [];
        this.save();
    }
}