class GitHubSync {
    static STATE_KEY = 'pastebox-github-sync-v1';
    static TOKEN_KEY = 'pastebox-github-credential-v1';
    static DATA_PATH = 'data/prompts.json';
    static MAX_BYTES = 750000;

    static validateItems(value) {
        if (!Array.isArray(value) || value.length > 2000) {
            throw new Error('프롬프트 데이터는 2,000개 이하의 배열이어야 합니다.');
        }

        const ids = new Set();
        const allowedTypes = new Set(['text', 'template', 'html']);

        const items = value.map(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error('올바르지 않은 프롬프트 항목입니다.');
            }

            if (
                typeof item.id !== 'string' ||
                !/^[A-Za-z0-9_-]{1,100}$/.test(item.id) ||
                ids.has(item.id)
            ) {
                throw new Error('항목 ID가 잘못되었거나 중복되었습니다.');
            }

            if (
                typeof item.title !== 'string' ||
                item.title.length > 500 ||
                typeof item.value !== 'string' ||
                !allowedTypes.has(item.type)
            ) {
                throw new Error('항목의 제목·내용·유형이 올바르지 않습니다.');
            }

            ids.add(item.id);

            return {
                id: item.id,
                title: item.title,
                type: item.type,
                value: item.value
            };
        });

        const bytes = new TextEncoder().encode(JSON.stringify(items)).byteLength;

        if (bytes > GitHubSync.MAX_BYTES) {
            throw new Error('데이터 크기가 750KB를 초과합니다. 항목을 줄여 주세요.');
        }

        return items;
    }

    constructor(dataService, callbacks = {}) {
        this.dataService = dataService;
        this.callbacks = callbacks;
        this.token = '';
        this.busy = false;
        this.suppressChange = false;
        this.revision = 0;
        this.timer = null;
        this.message = '';
        this.state = this._readState();
        this.token = this._readRememberedToken();

        this.dataService.onChange = () => {
            if (this.suppressChange) {
                return;
            }

            this.revision += 1;
            this.state.dirty = true;
            this.message = '';
            this._writeState();
            this._notify();
            this._schedulePush();
        };

        window.addEventListener('online', () => this._schedulePush());

        window.addEventListener('beforeunload', event => {
            if (this.state.repo && this.state.dirty) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
    }

    _readRememberedToken() {
        try {
            const saved = JSON.parse(
                localStorage.getItem(GitHubSync.TOKEN_KEY) || 'null'
            );

            if (
                !saved ||
                typeof saved.owner !== 'string' ||
                typeof saved.repo !== 'string' ||
                typeof saved.token !== 'string' ||
                saved.token.length === 0 ||
                saved.token.length > 1024 ||
                saved.owner.toLowerCase() !== this.state.owner.toLowerCase() ||
                saved.repo.toLowerCase() !== this.state.repo.toLowerCase()
            ) {
                return '';
            }

            return saved.token.trim();
        } catch {
            return '';
        }
    }

    _rememberToken(remember) {
        if (!remember) {
            localStorage.removeItem(GitHubSync.TOKEN_KEY);
            return;
        }

        if (!this.token || !this.state.owner || !this.state.repo) {
            throw new Error('저장할 연결 정보가 없습니다.');
        }

        localStorage.setItem(
            GitHubSync.TOKEN_KEY,
            JSON.stringify({
                owner: this.state.owner,
                repo: this.state.repo,
                token: this.token
            })
        );
    }

    _emptyState() {
        return {
            owner: '',
            repo: '',
            branch: '',
            sha: null,
            dirty: false,
            blocked: false,
            lastSync: ''
        };
    }

    _readState() {
        try {
            const raw = JSON.parse(
                localStorage.getItem(GitHubSync.STATE_KEY) || 'null'
            );

            if (
                !raw ||
                typeof raw.owner !== 'string' ||
                typeof raw.repo !== 'string' ||
                typeof raw.branch !== 'string' ||
                !/^[A-Za-z0-9-]+$/.test(raw.owner) ||
                !/^[A-Za-z0-9_.-]+$/.test(raw.repo)
            ) {
                return this._emptyState();
            }

            return {
                owner: raw.owner,
                repo: raw.repo,
                branch: raw.branch,
                sha: typeof raw.sha === 'string' ? raw.sha : null,
                dirty: raw.dirty === true,
                blocked: raw.blocked === true,
                lastSync: typeof raw.lastSync === 'string' ? raw.lastSync : ''
            };
        } catch {
            return this._emptyState();
        }
    }

    _writeState() {
        localStorage.setItem(
            GitHubSync.STATE_KEY,
            JSON.stringify(this.state)
        );
    }

    _notify() {
        if (typeof this.callbacks.onStatus === 'function') {
            this.callbacks.onStatus();
        }
    }

    _reloadView() {
        if (typeof this.callbacks.onReload === 'function') {
            this.callbacks.onReload();
        }
    }

    getStatusText() {
        if (this.busy) {
            return 'GitHub 통신 중';
        }

        if (this.message) {
            return this.message;
        }

        if (!this.state.repo) {
            return '로컬 저장 · GitHub 미연결';
        }

        if (this.state.blocked) {
            return '충돌 감지 · 백업 후 불러오기 필요';
        }

        if (!this.token) {
            return this.state.dirty
                ? '미전송 변경 있음 · 토큰 재입력 필요'
                : '로컬 사본 · 토큰 재입력 필요';
        }

        return this.state.dirty
            ? '로컬 저장됨 · GitHub 전송 대기'
            : 'GitHub 동기화 완료 · 불러오기로 최신 내용 확인';
    }

    _schedulePush() {
        clearTimeout(this.timer);

        if (
            !this.token ||
            !this.state.repo ||
            !this.state.dirty ||
            this.state.blocked
        ) {
            return;
        }

        this.timer = setTimeout(() => this.push(), 1200);
    }

    async _run(action) {
        if (this.busy) {
            showToast('진행 중인 GitHub 작업이 끝난 뒤 다시 시도해 주세요.', 'info');
            return false;
        }

        this.busy = true;
        this.message = '';
        this._notify();

        let succeeded = false;

        try {
            await action();
            succeeded = true;
            return true;
        } catch (error) {
            this.message = this.state.blocked
                ? '충돌 감지 · 백업 후 불러오기 필요'
                : 'GitHub 작업 실패 · 로컬 데이터 유지';

            showToast(error.message || 'GitHub 작업에 실패했습니다.', 'error');
            return false;
        } finally {
            this.busy = false;
            this._notify();

            if (succeeded && this.state.dirty) {
                this._schedulePush();
            }
        }
    }

    async _request(path, token, options = {}, allowMissing = false) {
        if (!token) {
            throw new Error('GitHub 연결에서 토큰을 입력해 주세요.');
        }

        if (!navigator.onLine) {
            throw new Error('오프라인입니다. 변경 내용은 로컬에 보관됩니다.');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        try {
            const response = await fetch(`https://api.github.com${path}`, {
                method: options.method || 'GET',
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                body: options.body,
                cache: 'no-store',
                credentials: 'omit',
                redirect: 'error',
                signal: controller.signal
            });

            if (response.status === 404 && allowMissing) {
                return null;
            }

            if (!response.ok) {
                const error = new Error(
                    response.status === 401
                        ? '토큰이 유효하지 않거나 만료되었습니다.'
                        : response.status === 403
                            ? '접근 권한 또는 GitHub API 사용 제한을 확인해 주세요.'
                            : response.status === 404
                                ? '저장소 이름과 토큰의 저장소 접근 권한을 확인해 주세요.'
                                : `GitHub 요청 실패: HTTP ${response.status}`
                );

                error.status = response.status;
                throw error;
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(
                    '요청 시간이 초과되었습니다. 저장 여부를 확인한 뒤 다시 시도해 주세요.'
                );
            }

            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    _repoPath(config) {
        return `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
    }

    _contentsPath(config) {
        const filePath = GitHubSync.DATA_PATH
            .split('/')
            .map(encodeURIComponent)
            .join('/');

        return `${this._repoPath(config)}/contents/${filePath}`;
    }

    _encode(text) {
        const bytes = new TextEncoder().encode(text);
        let binary = '';

        for (let index = 0; index < bytes.length; index += 8192) {
            binary += String.fromCharCode(
                ...bytes.subarray(index, index + 8192)
            );
        }

        return btoa(binary);
    }

    _decode(content) {
        const binary = atob(content.replace(/\s/g, ''));
        const bytes = Uint8Array.from(
            binary,
            character => character.charCodeAt(0)
        );

        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }

    async _readRemote(config, token) {
        const path =
            `${this._contentsPath(config)}?ref=${encodeURIComponent(config.branch)}`;

        const file = await this._request(path, token, {}, true);

        if (file === null) {
            return null;
        }

        if (
            file.type !== 'file' ||
            file.encoding !== 'base64' ||
            typeof file.content !== 'string' ||
            typeof file.sha !== 'string' ||
            file.size > GitHubSync.MAX_BYTES
        ) {
            throw new Error('원격 파일의 형식 또는 크기가 올바르지 않습니다.');
        }

        const decoded = JSON.parse(this._decode(file.content));

        if (
            !decoded ||
            decoded.version !== 1 ||
            !Array.isArray(decoded.items)
        ) {
            throw new Error('지원하지 않는 프롬프트 파일 형식입니다.');
        }

        return {
            sha: file.sha,
            items: GitHubSync.validateItems(decoded.items)
        };
    }

    _replaceLocal(items) {
        const validated = GitHubSync.validateItems(items);
        const previousItems = this.dataService.items;

        this.suppressChange = true;

        try {
            this.dataService.items = validated;
            this.dataService.save();
            this.revision += 1;
        } catch (error) {
            this.dataService.items = previousItems;
            throw error;
        } finally {
            this.suppressChange = false;
        }
    }

    openConnectionDialog() {
        if (this.busy || document.querySelector('.modal-overlay')) {
            showToast('열려 있는 작업을 마친 뒤 연결해 주세요.', 'info');
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <form class="modal" style="width:520px;">
                <div class="modal-header">
                    <h2 class="modal-title">비공개 GitHub 저장소 연결</h2>
                    <button type="button" class="modal-close"
                        data-action="close" aria-label="닫기">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="field-group">
                        <label class="field-label" for="gh-owner">저장소 소유자</label>
                        <input class="field-input" id="gh-owner"
                            name="owner" required autocomplete="off"
                            placeholder="gwakmae">
                    </div>
                    <div class="field-group">
                        <label class="field-label" for="gh-repo">비공개 저장소 이름</label>
                        <input class="field-input" id="gh-repo"
                            name="repo" required autocomplete="off"
                            placeholder="PasteBoxData">
                    </div>
                    <div class="field-group">
                        <label class="field-label" for="gh-token">GitHub 토큰</label>
                        <input class="field-input" id="gh-token"
                            name="token" type="password" required
                            autocomplete="off" spellcheck="false">
                    </div>
                    <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;">
                        <input type="checkbox" name="remember"
                            style="margin-top:4px;">
                        <span>
                            이 개인 기기에 토큰 기억
                            <small style="display:block;color:var(--text-secondary);">
                                브라우저에 암호화 없이 저장합니다. 공용 PC에서는 선택하지 마세요.
                            </small>
                        </span>
                    </label>
                    <p style="font-size:12px;color:var(--text-secondary);">
                        데이터 저장소는 README가 있는 비공개 저장소로 준비해 주세요.
                        해당 저장소의 Contents 읽기·쓰기 권한이 필요합니다.
                        ‘이 개인 기기에 토큰 기억’을 선택하면 다시 접속해도 연결 정보를 유지합니다.
                        선택하지 않으면 새로고침 시 토큰을 다시 입력해야 합니다.
                        연결 해제 시 이 브라우저에 기억한 토큰도 삭제합니다.
                        프롬프트 사본은 이 브라우저에 남습니다.
                    </p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary"
                        data-action="close">취소</button>
                    <button type="submit" class="btn btn-primary">연결</button>
                </div>
            </form>
        `;

        const form = overlay.querySelector('form');
        const ownerInput = form.elements.namedItem('owner');
        const repoInput = form.elements.namedItem('repo');
        const tokenInput = form.elements.namedItem('token');
        const rememberInput = form.elements.namedItem('remember');
        rememberInput.checked = Boolean(this._readRememberedToken());
        let submitting = false;

        ownerInput.value = this.state.owner;
        repoInput.value = this.state.repo;
        tokenInput.value = this.token;

        const close = () => {
            if (!submitting) {
                tokenInput.value = '';
                overlay.remove();
            }
        };

        overlay.querySelectorAll('[data-action="close"]').forEach(button => {
            button.addEventListener('click', close);
        });

        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                close();
            }
        });

        form.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        });

        form.addEventListener('submit', async event => {
            event.preventDefault();

            if (submitting) {
                return;
            }

            const owner = ownerInput.value.trim();
            const repo = repoInput.value.trim();
            const token = tokenInput.value.trim();

            if (
                !/^[A-Za-z0-9-]+$/.test(owner) ||
                !/^[A-Za-z0-9_.-]+$/.test(repo) ||
                repo === '.' ||
                repo === '..' ||
                !token
            ) {
                showToast('소유자·저장소 이름·토큰을 확인해 주세요.', 'error');
                return;
            }

            submitting = true;
            form.querySelectorAll('input, button').forEach(element => {
                element.disabled = true;
            });

            const connected = await this.connect(owner, repo, token);

            submitting = false;

            if (connected) {
                try {
                    this._rememberToken(rememberInput.checked);
                } catch {
                    try {
                        localStorage.removeItem(GitHubSync.TOKEN_KEY);
                    } catch {
                        // 저장소 접근이 차단된 경우 현재 페이지의 메모리 연결만 유지합니다.
                    }

                    showToast(
                        '연결은 완료됐지만 토큰 기억에 실패했습니다. 다음 접속 시 다시 입력해 주세요.',
                        'error'
                    );
                }
                tokenInput.value = '';
                overlay.remove();
            } else {
                form.querySelectorAll('input, button').forEach(element => {
                    element.disabled = false;
                });
            }
        });

        document.body.appendChild(overlay);
        ownerInput.focus();
    }

    async connect(owner, repo, token) {
        return this._run(async () => {
            const revision = this.revision;
            const candidate = { owner, repo, branch: '' };
            const repository = await this._request(
                this._repoPath(candidate),
                token
            );

            if (repository.private !== true) {
                throw new Error(
                    '데이터 저장소는 비공개여야 합니다. 공개 앱 저장소와 분리해 주세요.'
                );
            }

            if (!repository.default_branch) {
                throw new Error('데이터 저장소에 README를 먼저 만들어 주세요.');
            }

            candidate.owner = repository.owner.login;
            candidate.repo = repository.name;
            candidate.branch = repository.default_branch;

            const sameRepository =
                this.state.owner.toLowerCase() === candidate.owner.toLowerCase() &&
                this.state.repo.toLowerCase() === candidate.repo.toLowerCase();

            if (
                sameRepository &&
                this.state.branch &&
                this.state.branch !== candidate.branch
            ) {
                throw new Error(
                    '기본 브랜치가 변경되었습니다. JSON 백업 후 연결을 해제하고 다시 연결해 주세요.'
                );
            }

            if (sameRepository && this.state.dirty) {
                this.token = token;
                this.state.branch = candidate.branch;
                this._writeState();

                if (this.state.blocked) {
                    showToast(
                        '연결되었습니다. JSON 백업 후 불러오기로 충돌을 해결해 주세요.',
                        'info'
                    );
                    return;
                }

                await this._pushInternal();
                return;
            }

            const remote = await this._readRemote(candidate, token);

            if (revision !== this.revision) {
                throw new Error('연결 중 로컬 내용이 변경되었습니다. 다시 연결해 주세요.');
            }

            if (remote) {
                if (
                    !confirm(
                        '저장소의 프롬프트로 현재 브라우저 내용을 교체합니다.\n' +
                        '현재 내용이 필요하면 취소하고 Export로 먼저 백업해 주세요.\n' +
                        '계속할까요?'
                    )
                ) {
                    throw new Error('연결을 취소했습니다.');
                }

                this._replaceLocal(remote.items);
            } else {
                if (
                    !confirm(
                        '원격 프롬프트 파일이 없습니다.\n' +
                        '현재 브라우저의 항목으로 새 파일을 만들까요?'
                    )
                ) {
                    throw new Error('연결을 취소했습니다.');
                }
            }

            this.token = token;
            this.state = {
                ...candidate,
                sha: remote ? remote.sha : null,
                dirty: remote === null,
                blocked: false,
                lastSync: remote ? new Date().toISOString() : ''
            };
            this._writeState();
            this._reloadView();

            if (remote === null) {
                await this._pushInternal();
            } else {
                showToast('비공개 저장소를 연결했습니다.', 'success');
            }
        });
    }

    async push() {
        return this._run(() => this._pushInternal());
    }

    async _pushInternal() {
        if (!this.state.repo || !this.token) {
            throw new Error('GitHub 연결에서 저장소와 토큰을 입력해 주세요.');
        }

        if (this.state.blocked) {
            throw new Error(
                '충돌 상태입니다. Export로 백업한 뒤 불러오기를 사용해 주세요.'
            );
        }

        if (!this.state.dirty) {
            showToast('전송할 변경이 없습니다. 최신 원격 내용은 불러오기로 확인하세요.', 'info');
            return;
        }

        const revision = this.revision;
        const items = GitHubSync.validateItems(this.dataService.getAll());
        const payload = JSON.stringify({
            version: 1,
            updatedAt: new Date().toISOString(),
            items
        });

        if (new TextEncoder().encode(payload).byteLength > GitHubSync.MAX_BYTES) {
            throw new Error('동기화 파일이 750KB를 초과합니다.');
        }

        const body = {
            message: 'Update PasteBox prompts',
            branch: this.state.branch,
            content: this._encode(payload)
        };

        if (this.state.sha) {
            body.sha = this.state.sha;
        }

        let result;

        try {
            result = await this._request(
                this._contentsPath(this.state),
                this.token,
                {
                    method: 'PUT',
                    body: JSON.stringify(body)
                }
            );
        } catch (error) {
            if (error.status === 409 || error.status === 422) {
                this.state.blocked = true;
                this._writeState();
                throw new Error(
                    '충돌 또는 저장 조건 오류입니다. Export로 백업한 뒤 불러오기를 사용하세요.'
                );
            }

            throw error;
        }

        if (!result.content || typeof result.content.sha !== 'string') {
            throw new Error(
                '저장 결과를 확인할 수 없습니다. 불러오기로 원격 내용을 확인해 주세요.'
            );
        }

        this.state.sha = result.content.sha;
        this.state.dirty = this.revision !== revision;
        this.state.blocked = false;
        this.state.lastSync = new Date().toISOString();
        this._writeState();

        showToast(
            this.state.dirty
                ? '저장 완료. 추가 변경을 이어서 전송합니다.'
                : 'GitHub에 저장했습니다.',
            'success'
        );
    }

    async pull() {
        if (document.querySelector('.modal-overlay')) {
            showToast('편집 창을 닫은 뒤 불러와 주세요.', 'info');
            return false;
        }

        return this._run(async () => {
            if (!this.state.repo || !this.token) {
                throw new Error('GitHub 연결에서 토큰을 입력해 주세요.');
            }

            if (
                (this.state.dirty || this.state.blocked) &&
                !confirm(
                    '미전송 변경 또는 충돌이 있습니다.\n' +
                    '필요한 내용은 Export로 먼저 백업해야 합니다.\n' +
                    '현재 로컬 내용을 버리고 GitHub 내용을 불러올까요?'
                )
            ) {
                return;
            }

            const revision = this.revision;
            const remote = await this._readRemote(this.state, this.token);

            if (!remote) {
                throw new Error(
                    '원격 프롬프트 파일을 찾지 못했습니다. 로컬 내용은 유지됩니다.'
                );
            }

            if (
                revision !== this.revision ||
                document.querySelector('.modal-overlay')
            ) {
                throw new Error(
                    '불러오는 동안 편집이 시작되었습니다. 로컬 내용은 유지됩니다.'
                );
            }

            this._replaceLocal(remote.items);
            this.state.sha = remote.sha;
            this.state.dirty = false;
            this.state.blocked = false;
            this.state.lastSync = new Date().toISOString();
            this._writeState();
            this._reloadView();

            showToast('GitHub의 최신 내용을 불러왔습니다.', 'success');
        });
    }

    disconnect() {
        if (this.busy || document.querySelector('.modal-overlay')) {
            showToast('진행 중인 작업을 마친 뒤 연결을 해제해 주세요.', 'info');
            return;
        }

        const warning = this.state.dirty
            ? '미전송 변경이 있습니다. 필요한 내용은 Export로 먼저 백업하세요.\n'
            : '';

        if (
            !confirm(
                warning +
                '연결을 해제하고 이 브라우저의 프롬프트 사본도 삭제할까요?\n' +
                'GitHub 저장소의 데이터는 삭제하지 않습니다.'
            )
        ) {
            return;
        }

        try {
            clearTimeout(this.timer);
            localStorage.removeItem(GitHubSync.TOKEN_KEY);
            this._replaceLocal([]);
            this.token = '';
            this.state = this._emptyState();
            this.message = '';
            localStorage.removeItem(GitHubSync.STATE_KEY);
            this._reloadView();
            this._notify();

            showToast('연결과 이 브라우저의 사본을 제거했습니다.', 'info');
        } catch {
            showToast('로컬 저장소 정리에 실패했습니다. 브라우저 저장 공간을 확인하세요.', 'error');
        }
    }
}