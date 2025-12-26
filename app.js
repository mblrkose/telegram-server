class FileUploader {
    constructor() {
        this.fileInput = document.getElementById('fileInput');
        this.uploadList = document.getElementById('uploadList');
        this.uploadItemTemplate = document.getElementById('uploadItemTemplate');
        this.activeUploads = new Map();
        this.setupEventListeners();
        this.initializeIp();
    }

    async initializeIp() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            this.userIp = data.ip;
        } catch (error) {
            console.error('IP info could not be retrieved:', error);
            this.userIp = 'unknown';
        }
    }

    setupEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    handleFileSelect(e) {
        const files = e.target.files;
        if (files.length === 0) return;

        this.processFiles(files);
        this.fileInput.value = '';
    }

    processFiles(files) {
        Array.from(files).forEach(file => {
            const uploadId = this.generateUploadId();
            this.createUploadItem(uploadId, file);
            this.startUpload(uploadId, file);
        });
    }

    generateUploadId() {
        return `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    createUploadItem(uploadId, file) {
        const uploadItem = this.uploadItemTemplate.content.cloneNode(true).querySelector('.upload-item');
        uploadItem.id = uploadId;

        const filenameInput = uploadItem.querySelector('.filename-input');
        const fileSize = uploadItem.querySelector('.file-size');
        const editBtn = uploadItem.querySelector('.edit-name-btn');
        const cancelBtn = uploadItem.querySelector('.cancel-btn');

        filenameInput.value = file.name;
        fileSize.textContent = this.formatFileSize(file.size);

        editBtn.addEventListener('click', () => {
            filenameInput.disabled = !filenameInput.disabled;
            filenameInput.focus();
        });

        cancelBtn.addEventListener('click', () => this.cancelUpload(uploadId));

        this.uploadList.appendChild(uploadItem);
        this.activeUploads.set(uploadId, { file, status: 'pending' });
    }

    async startUpload(uploadId, file) {
        const upload = this.activeUploads.get(uploadId);
        if (!upload || upload.status === 'cancelled') return;

        const uploadItem = document.getElementById(uploadId);
        const progressFill = uploadItem.querySelector('.progress-fill');
        const progressText = uploadItem.querySelector('.progress-text');
        const speedText = uploadItem.querySelector('.upload-speed');
        const filenameInput = uploadItem.querySelector('.filename-input');

        const statusDiv = document.createElement('div');
        statusDiv.className = 'upload-status';
        uploadItem.querySelector('.progress-details').appendChild(statusDiv);

        // Check file size (50MB = 50 * 1024 * 1024 bytes)
        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
            upload.status = 'error';
            this.updateProgress(uploadItem, 0);
            speedText.textContent = '0 MB/s';
            statusDiv.textContent = `❌ Error: File size too large (Maximum: 50MB)`;
            return;
        }

        upload.status = 'uploading';
        let lastLoaded = 0;
        let lastTime = Date.now();

        try {
            statusDiv.textContent = `📤 Uploading: ${filenameInput.value}`;

            const formData = new FormData();
            formData.append('chat_id', CONFIG.CHAT_ID);
            formData.append('document', file, filenameInput.value);

            const xhr = new XMLHttpRequest();

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const currentTime = Date.now();
                    const timeDiff = (currentTime - lastTime) / 1000;
                    const loadedDiff = event.loaded - lastLoaded;

                    const speedMBps = (loadedDiff / (1024 * 1024)) / timeDiff;
                    speedText.textContent = speedMBps.toFixed(1) + ' MB/s';

                    const percentComplete = (event.loaded / event.total) * 100;
                    this.updateProgress(uploadItem, percentComplete);
                    statusDiv.textContent = `📤 Uploading: ${filenameInput.value} (${Math.round(percentComplete)}%)`;

                    lastLoaded = event.loaded;
                    lastTime = currentTime;
                }
            };

            xhr.onload = async () => {
                if (xhr.status === 200) {
                    try {
                        const result = JSON.parse(xhr.responseText);
                        if (result.ok) {
                            this.updateProgress(uploadItem, 100);
                            speedText.textContent = '0 MB/s';
                            statusDiv.textContent = `✅ Completed: ${filenameInput.value}`;
                            upload.status = 'completed';
                        } else {
                            throw new Error('Upload failed: ' + (result.description || 'Unknown error'));
                        }
                    } catch (error) {
                        throw new Error('Error processing response: ' + error.message);
                    }
                } else {
                    throw new Error('HTTP Error! Status: ' + xhr.status);
                }
            };

            xhr.onerror = () => {
                throw new Error('Network error occurred');
            };

            xhr.ontimeout = () => {
                throw new Error('Upload timed out');
            };

            xhr.timeout = 0;
            xhr.open('POST', `${CONFIG.API_BASE_URL}${CONFIG.BOT_TOKEN}/sendDocument`, true);
            xhr.send(formData);

        } catch (error) {
            console.error('Upload error:', error);
            upload.status = 'error';
            this.updateProgress(uploadItem, 0);
            speedText.textContent = '0 MB/s';
            statusDiv.textContent = `❌ Error: ${filenameInput.value} - ${error.message}`;
        }
    }

    updateProgress(uploadItem, progress) {
        const progressFill = uploadItem.querySelector('.progress-fill');
        const progressText = uploadItem.querySelector('.progress-text');

        progress = Math.max(0, Math.min(100, progress));

        progressFill.style.width = `${progress}%`;
        progressText.textContent = `${Math.round(progress)}%`;
    }

    cancelUpload(uploadId) {
        const upload = this.activeUploads.get(uploadId);
        if (upload) {
            upload.status = 'cancelled';
            const uploadItem = document.getElementById(uploadId);
            uploadItem.remove();
            this.activeUploads.delete(uploadId);
        }
    }

    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }

    async sendTelegramMessage(text, reply_to_message_id = null) {
        const params = {
            chat_id: CONFIG.CHAT_ID,
            text: text
        };

        if (reply_to_message_id) {
            params.reply_to_message_id = reply_to_message_id;
        }

        const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params)
        });

        return response.json();
    }
}

const fileUploader = new FileUploader();
