const path = require('path').posix;
const { Plugin, Notice, TFile, MarkdownView, resolveSubpath } = require('obsidian');

const POSTS_ROOT = 'source/_posts';
const DRAFTS_ROOT = 'source/_drafts';
const PRIVATE_DRAFTS_ROOT = 'source/_drafts/private';
const SUCCESS_NOTICE_TIMEOUT = 3000;
const PERSISTENT_NOTICE_TIMEOUT = 0;
const CLIPBOARD_CONTEXT_TTL_MS = 5 * 60 * 1000;

function normalizeVaultPath(fileOrPath) {
    const filePath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath?.path;
    if (typeof filePath !== 'string') return '';
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isManagedMarkdownFile(file) {
    const normalizedPath = normalizeVaultPath(file);
    return !!file && file.extension === 'md' && (
        normalizedPath.startsWith(`${POSTS_ROOT}/`) ||
        normalizedPath.startsWith(`${DRAFTS_ROOT}/`)
    );
}

function isManagedMarkdownPath(filePath) {
    const normalizedPath = normalizeVaultPath(filePath);
    return normalizedPath.endsWith('.md') && (
        normalizedPath.startsWith(`${POSTS_ROOT}/`) ||
        normalizedPath.startsWith(`${DRAFTS_ROOT}/`)
    );
}

function isValidAbbrlink(value) {
    return /^[A-Za-z0-9]+$/.test(String(value || '').trim());
}

function shouldApplyManagedTemplate(file) {
    return !!file && file.extension === 'md' && (
        file.path.startsWith(`${POSTS_ROOT}/`) ||
        file.path.startsWith(`${DRAFTS_ROOT}/`)
    );
}

function isPostFile(fileOrPath) {
    return normalizeVaultPath(fileOrPath).startsWith(`${POSTS_ROOT}/`);
}

function isDraftFile(fileOrPath) {
    return normalizeVaultPath(fileOrPath).startsWith(`${DRAFTS_ROOT}/`);
}

function getManagedImageBaseForFile(fileOrPath) {
    const filePath = normalizeVaultPath(fileOrPath);
    const articleFolder = path.dirname(filePath);
    return path.join(path.dirname(articleFolder), 'img');
}

function getManagedImageFolderForAbbrlink(fileOrPath, abbrlink) {
    return path.join(getManagedImageBaseForFile(fileOrPath), String(abbrlink || '').trim());
}

function buildManagedImageLink(fileOrPath, abbrlink, imageName) {
    const filePath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
    const targetPath = path.join(getManagedImageFolderForAbbrlink(fileOrPath, abbrlink), imageName);
    return path.relative(path.dirname(filePath), targetPath) || imageName;
}

function isLocalImageLink(linkTarget) {
    return !!linkTarget &&
        !/^(https?:|data:|\/)/i.test(linkTarget) &&
        !/^<.*>$/.test(linkTarget);
}

function isImagePath(linkTarget) {
    return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(linkTarget);
}

function normalizeClipboardText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trimEnd();
}

function normalizeImageExtension(mimeType, originalName) {
    let ext = 'png';

    if (mimeType) {
        const parts = String(mimeType).split('/');
        if (parts.length === 2 && parts[1]) {
            ext = parts[1];
        }
    }

    if (originalName && originalName.lastIndexOf('.') !== -1) {
        const potentialExt = originalName.split('.').pop();
        if (potentialExt) {
            ext = potentialExt;
        }
    }

    ext = String(ext || 'png').trim().toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    ext = ext.replace(/[^a-z0-9]/g, '');
    return ext || 'png';
}

function getExtensionFromPath(filePath) {
    const ext = path.extname(String(filePath || '')).replace(/^\./, '').toLowerCase();
    return ext || 'png';
}

function hexoSlug(value) {
    const normalized = String(value || '').normalize('NFKC');
    const allowedChars = '-_~';
    const result = [];

    for (const char of normalized) {
        const code = char.codePointAt(0);

        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0xAC00 && code <= 0xD7A3)) {
            result.push(char);
            continue;
        }

        if ((code >= 0x3000 && code <= 0x3002) || (code >= 0xFF01 && code <= 0xFF02)) {
            result.push(' ');
            continue;
        }

        if (allowedChars.includes(char) || /[\p{L}\p{N}\p{M}]/u.test(char)) {
            result.push(char);
        } else if (/\p{Z}/u.test(char)) {
            result.push(' ');
        }
    }

    return result
        .join('')
        .trim()
        .replace(/[\s-]+/g, '-')
        .toLowerCase();
}

function formatMarkdownLinkLabel(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/\[/g, '(')
        .replace(/\]/g, ')');
}

function buildHexoHeadingTargets(cache) {
    const slugCounts = new Map();

    return (cache?.headings || []).map((heading) => {
        const baseSlug = hexoSlug(heading.heading);
        const count = (slugCounts.get(baseSlug) || 0) + 1;
        slugCounts.set(baseSlug, count);

        return {
            heading,
            slug: count > 1 ? `${baseSlug}-${count}` : baseSlug
        };
    });
}

function findHeadingByHexoSlug(cache, hash) {
    const requestedSlug = String(hash || '').replace(/^#/, '');
    if (!requestedSlug) return null;
    return buildHexoHeadingTargets(cache).find((target) => target.slug === requestedSlug) || null;
}

function getHexoSlugForHeadingLine(cache, line, fallbackHeading) {
    const target = buildHexoHeadingTargets(cache)
        .find((item) => item.heading?.position?.start?.line === line);
    return target?.slug || hexoSlug(fallbackHeading);
}

const makeCRCTable = () => {
    let c;
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[n] = c;
    }
    return crcTable;
};

const crcTable = makeCRCTable();
const crc32 = (str) => {
    let crc = 0 ^ (-1);
    for (let i = 0; i < str.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
};

module.exports = class HexoHelperPlugin extends Plugin {
    showSuccessNotice(message) {
        return new Notice(message, SUCCESS_NOTICE_TIMEOUT);
    }

    showPersistentNotice(message) {
        return new Notice(message, PERSISTENT_NOTICE_TIMEOUT);
    }

    async onload() {
        this.abbrlinkMap = new Map();
        this.lastCopiedMarkdownContext = null;
        this.pendingNewManagedFiles = new Set();
        this.programmaticImageMoves = new Set();
        this.imageLinkRepairTimers = new Map();

        await this.buildAbbrlinkMap();
        this.app.workspace.onLayoutReady(() => {
            this.buildAbbrlinkMap();
        });
        this.registerEvent(this.app.metadataCache.on('resolved', () => {
            this.buildAbbrlinkMap();
        }));

        this.originalOpenLinkText = this.app.workspace.openLinkText;
        this.app.workspace.openLinkText = async (linktext, sourcePath, newLeaf, openViewState) => {
            if (linktext && (linktext.startsWith('/posts/') || linktext.startsWith('posts/'))) {
                try {
                    const match = linktext.match(/(?:\/)?posts\/([a-zA-Z0-9]+)\/?(#.*)?/);
                    if (match && match[1]) {
                        const abbrlink = match[1];
                        let hash = match[2] || '';

                        if (hash) {
                            try {
                                hash = decodeURIComponent(hash);
                            } catch (e) {}
                        }

                        const targetFile = await this.resolveManagedFileByAbbrlink(abbrlink);
                        if (targetFile instanceof TFile) {
                            return this.openManagedHexoLink(targetFile, hash, newLeaf, openViewState);
                        }
                    }
                } catch (e) {
                    console.error('Hexo Helper: Error intercepting openLinkText', e);
                }
            }

            return this.originalOpenLinkText.call(this.app.workspace, linktext, sourcePath, newLeaf, openViewState);
        };

        this.registerEvent(this.app.vault.on('modify', async (file) => {
            if (!isManagedMarkdownFile(file)) return;
            const abbrlink = await this.updateAbbrlinkMap(file);
            this.queueManagedImageLinkRepair(file, abbrlink);
        }));

        this.registerEvent(this.app.vault.on('create', async (file) => {
            if (!shouldApplyManagedTemplate(file)) return;

            if (isManagedMarkdownFile(file)) {
                this.pendingNewManagedFiles.add(file);
                this.updateAbbrlinkMap(file);
            }

            setTimeout(async () => {
                try {
                    await this.applyHexoTemplate(file);
                } finally {
                    this.pendingNewManagedFiles.delete(file);
                }
            }, 100);
        }));

        this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            await this.handleManagedMarkdownRename(file, oldPath);
        }));

        this.registerDomEvent(document, 'copy', () => {
            this.captureCopiedMarkdownContext();
        });

        this.registerEvent(
            this.app.workspace.on('editor-paste', async (evt, editor, view) => {
                await this.handlePaste(evt, editor, view);
            })
        );

        this.registerEvent(
            this.app.workspace.on('editor-drop', async (evt, editor, view) => {
                await this.handleDrop(evt, editor, view);
            })
        );

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (!(view instanceof MarkdownView) || !(view.file instanceof TFile) || view.file.extension !== 'md') {
                    return;
                }

                menu.addItem((item) => {
                    item.setTitle('Copy Hexo Link').setIcon('link').onClick(() => this.copyHexoLink(view.file, editor));
                });
            })
        );

        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (!(file instanceof TFile) || file.extension !== 'md') return;

                menu.addItem((item) => {
                    item.setTitle('Copy Hexo Link').setIcon('link').onClick(() => this.copyHexoLink(file, null));
                });

                if (isDraftFile(file)) {
                    menu.addItem((item) => {
                        item.setTitle('hexo_发布至博客').setIcon('send').onClick(() => this.publishManagedFile(file));
                    });
                }

                if (isPostFile(file)) {
                    menu.addItem((item) => {
                        item.setTitle('hexo_收归私有').setIcon('archive').onClick(() => this.privatizeManagedFile(file));
                    });
                }
            })
        );
    }

    onunload() {
        if (this.imageLinkRepairTimers) {
            for (const timer of this.imageLinkRepairTimers.values()) {
                clearTimeout(timer);
            }
            this.imageLinkRepairTimers.clear();
        }
        if (this.originalOpenLinkText) {
            this.app.workspace.openLinkText = this.originalOpenLinkText;
        }
    }

    captureCopiedMarkdownContext() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const activeFile = activeView?.file;
        const selection = activeView?.editor?.getSelection?.();

        if (!isManagedMarkdownFile(activeFile) || !selection) {
            this.lastCopiedMarkdownContext = null;
            return;
        }

        this.lastCopiedMarkdownContext = {
            sourcePath: activeFile.path,
            text: normalizeClipboardText(selection),
            timestamp: Date.now()
        };
    }

    buildDefaultFrontmatter(title, date, abbrlink) {
        return `---
title: ${title}
date: ${date}
tags: 
categories: 
description: 
swiper_index: 
abbrlink: ${abbrlink}
---

`;
    }

    async applyHexoTemplate(file) {
        if (!(file instanceof TFile) || !shouldApplyManagedTemplate(file)) {
            return null;
        }

        const existingAbbrlink = await this.getAbbrlinkForFile(file);
        if (existingAbbrlink) {
            return existingAbbrlink;
        }

        const title = file.basename;
        const date = window.moment().format('YYYY-MM-DD HH:mm:ss');
        const abbrlinkSource = title + date;
        const abbrlink = crc32(abbrlinkSource).toString(16);
        const content = await this.app.vault.read(file);
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);

        if (frontmatterMatch) {
            const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
            const frontmatterBody = frontmatterMatch[1];
            const updatedFrontmatter = `---${lineEnding}${frontmatterBody}${lineEnding}abbrlink: ${abbrlink}${lineEnding}---`;
            const remainder = content.slice(frontmatterMatch[0].length);
            const updatedContent = `${updatedFrontmatter}${lineEnding}${remainder}`;

            await this.app.vault.modify(file, updatedContent);
            await this.updateAbbrlinkMap(file);
            new Notice('Hexo abbrlink applied!');
            return abbrlink;
        }

        const template = this.buildDefaultFrontmatter(title, date, abbrlink);
        const updatedContent = content && content.length > 0 ? `${template}${content}` : template;
        await this.app.vault.modify(file, updatedContent);
        await this.updateAbbrlinkMap(file);
        new Notice('Hexo Front-matter applied!');
        return abbrlink;
    }

    async buildAbbrlinkMap() {
        this.abbrlinkMap.clear();
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            if (isManagedMarkdownFile(file)) {
                await this.updateAbbrlinkMap(file);
            }
        }
    }

    async getAbbrlinkForFile(file) {
        const cache = this.app.metadataCache.getFileCache(file);
        const cachedAbbrlink = cache?.frontmatter?.abbrlink;
        if (cachedAbbrlink !== undefined && cachedAbbrlink !== null && String(cachedAbbrlink).trim() !== '') {
            return String(cachedAbbrlink).trim();
        }

        const content = await this.app.vault.cachedRead(file);
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!frontmatterMatch) return null;

        const abbrlinkMatch = frontmatterMatch[1].match(/^\s*abbrlink\s*:\s*(.+?)\s*$/m);
        if (!abbrlinkMatch) return null;

        return abbrlinkMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    async updateAbbrlinkMap(file) {
        for (const [k, v] of this.abbrlinkMap) {
            if (v === file.path) this.abbrlinkMap.delete(k);
        }

        const abbrlink = await this.getAbbrlinkForFile(file);
        if (abbrlink) {
            this.abbrlinkMap.set(abbrlink, file.path);
        }
        return abbrlink;
    }

    async resolveManagedFileByAbbrlink(abbrlink) {
        const cachedFilePath = this.abbrlinkMap.get(abbrlink);
        const cachedFile = cachedFilePath ? this.app.vault.getAbstractFileByPath(cachedFilePath) : null;
        if (cachedFile instanceof TFile) {
            return cachedFile;
        }

        if (cachedFilePath) {
            this.abbrlinkMap.delete(abbrlink);
        }

        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            if (!isManagedMarkdownFile(file)) continue;

            const fileAbbrlink = await this.getAbbrlinkForFile(file);
            if (!fileAbbrlink) continue;

            this.abbrlinkMap.set(fileAbbrlink, file.path);
            if (fileAbbrlink === abbrlink) {
                return file;
            }
        }

        return null;
    }

    async openManagedHexoLink(targetFile, hash, newLeaf, openViewState) {
        const leaf = this.app.workspace.getLeaf(newLeaf);
        await leaf.openFile(targetFile, openViewState);
        this.app.workspace.setActiveLeaf(leaf, true, true);
        this.app.workspace.revealLeaf(leaf);

        if (!hash) return;

        const cache = this.app.metadataCache.getFileCache(targetFile);
        const hexoTarget = findHeadingByHexoSlug(cache, hash);
        const resolved = hexoTarget ? null : (cache ? resolveSubpath(cache, hash) : null);
        const targetPosition = hexoTarget?.heading?.position?.start || resolved?.start;

        if (!targetPosition) {
            new Notice(`Article opened, but heading anchor was not found: ${hash}`);
            return;
        }

        if (!(leaf.view instanceof MarkdownView)) {
            new Notice(`Article opened, but its heading could not be focused: ${hash}`);
            return;
        }

        if (typeof leaf.setEphemeralState === 'function') {
            const obsidianSubpath = hexoTarget
                ? `#${hexoTarget.heading.heading}`
                : hash;
            leaf.setEphemeralState({ subpath: obsidianSubpath });
        }

        const editor = leaf.view.editor;
        const targetLine = Math.max(0, Math.min(targetPosition.line, editor.lastLine()));
        const lineText = editor.getLine(targetLine) || '';
        const from = { line: targetLine, ch: 0 };
        const to = { line: targetLine, ch: lineText.length };

        editor.setCursor(from);
        editor.scrollIntoView({ from, to }, 120);
        editor.focus();
    }

    async ensureFolderExists(folderPath) {
        if (!this.app.vault.getAbstractFileByPath(folderPath)) {
            await this.app.vault.createFolder(folderPath);
        }
    }

    async ensureFolderPath(folderPath) {
        const normalizedPath = normalizeVaultPath(folderPath);
        const parts = normalizedPath.split('/').filter(Boolean);
        let current = '';

        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            await this.ensureFolderExists(current);
        }
    }

    async ensureAbbrlinkReady(file) {
        let abbrlink = await this.getAbbrlinkForFile(file);
        if (abbrlink) return abbrlink;

        if (!this.pendingNewManagedFiles?.has(file)) {
            this.showPersistentNotice(`Current file has no abbrlink, image import was skipped: ${file.path}`);
            return null;
        }

        await this.applyHexoTemplate(file);
        await this.updateAbbrlinkMap(file);
        abbrlink = await this.getAbbrlinkForFile(file);
        if (abbrlink) return abbrlink;

        this.showPersistentNotice(`Current file has no abbrlink, image import was skipped: ${file.path}`);
        return null;
    }

    async getNextManagedImageName(folderPath, abbrlink, ext) {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        const pattern = new RegExp(`^${String(abbrlink).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-([0-9]+)\\.[^.]+$`, 'i');
        let maxIndex = 0;

        if (folder?.children) {
            for (const child of folder.children) {
                if (!(child instanceof TFile)) continue;
                const match = child.name.match(pattern);
                if (!match) continue;
                maxIndex = Math.max(maxIndex, Number(match[1]) || 0);
            }
        }

        return `${abbrlink}-${maxIndex + 1}.${ext}`;
    }

    async createManagedImageFile(arrayBuffer, activeFile, ext) {
        const abbrlink = await this.ensureAbbrlinkReady(activeFile);
        if (!abbrlink) return null;

        const baseFolder = getManagedImageBaseForFile(activeFile);
        const targetFolder = getManagedImageFolderForAbbrlink(activeFile, abbrlink);
        await this.ensureFolderPath(baseFolder);
        await this.ensureFolderExists(targetFolder);

        const normalizedExt = normalizeImageExtension(null, `x.${ext}`);
        const fileName = await this.getNextManagedImageName(targetFolder, abbrlink, normalizedExt);
        const targetPath = path.join(targetFolder, fileName);
        await this.app.vault.createBinary(targetPath, arrayBuffer);

        return {
            abbrlink,
            fileName,
            relPath: buildManagedImageLink(activeFile, abbrlink, fileName),
            targetPath
        };
    }

    getClipboardSourcePath(text, activeFile) {
        const normalizedText = normalizeClipboardText(text);
        const context = this.lastCopiedMarkdownContext;

        if (
            context &&
            normalizedText &&
            context.text === normalizedText &&
            Date.now() - context.timestamp <= CLIPBOARD_CONTEXT_TTL_MS
        ) {
            return context.sourcePath;
        }

        return activeFile?.path || null;
    }

    async copyVaultImageIntoCurrentArticle(sourceAsset, activeFile) {
        const buffer = await this.app.vault.readBinary(sourceAsset);
        return this.createManagedImageFile(buffer, activeFile, getExtensionFromPath(sourceAsset.path));
    }

    async rewritePastedMarkdownImages(text, activeFile) {
        const sourcePath = this.getClipboardSourcePath(text, activeFile);
        if (!sourcePath || !text.includes('![')) return null;

        const matches = [...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
        if (matches.length === 0) return null;

        let result = '';
        let lastIndex = 0;
        let changed = false;

        for (const match of matches) {
            const rawTarget = String(match[2] || '').trim();
            let replacement = match[0];

            if (isLocalImageLink(rawTarget) && isImagePath(rawTarget)) {
                const cleanTarget = rawTarget.replace(/^<|>$/g, '');
                const sourceAssetPath = path.normalize(path.join(path.dirname(sourcePath), cleanTarget));
                const sourceAsset = this.app.vault.getAbstractFileByPath(sourceAssetPath);

                if (sourceAsset instanceof TFile) {
                    const created = await this.copyVaultImageIntoCurrentArticle(sourceAsset, activeFile);
                    if (created) {
                        replacement = `![${created.fileName}](${created.relPath})`;
                        changed = true;
                    }
                }
            }

            result += text.slice(lastIndex, match.index);
            result += replacement;
            lastIndex = match.index + match[0].length;
        }

        if (!changed) return null;

        result += text.slice(lastIndex);
        return result;
    }

    replacePastedTextRange(editor, originalText, rewrittenText) {
        if (!editor || !originalText || originalText === rewrittenText) return false;

        const cursor = editor.getCursor('to');
        const cursorOffset = editor.posToOffset(cursor);
        const directFromOffset = Math.max(0, cursorOffset - originalText.length);
        const directFrom = editor.offsetToPos(directFromOffset);
        const directText = editor.getRange(directFrom, cursor);

        if (directText === originalText) {
            editor.replaceRange(rewrittenText, directFrom, cursor, 'paste');
            editor.setCursor(editor.offsetToPos(directFromOffset + rewrittenText.length));
            return true;
        }

        const startOffset = editor.posToOffset(editor.getCursor('from'));
        window.setTimeout(() => {
            const from = editor.offsetToPos(startOffset);
            const to = editor.offsetToPos(startOffset + originalText.length);
            const currentText = editor.getRange(from, to);
            if (currentText !== originalText) return;

            editor.replaceRange(rewrittenText, from, to, 'paste');
            editor.setCursor(editor.offsetToPos(startOffset + rewrittenText.length));
        }, 0);

        return true;
    }

    async handleManagedMarkdownRename(file, oldPath) {
        if (isManagedMarkdownFile(file)) {
            const abbrlink = await this.updateAbbrlinkMap(file);
            if (!this.programmaticImageMoves.has(file.path)) {
                await this.migrateImagesOnManagedMove(file, oldPath);
            }
            this.queueManagedImageLinkRepair(file, abbrlink);
            return;
        }

        for (const [k, v] of this.abbrlinkMap) {
            if (v === oldPath) {
                this.abbrlinkMap.delete(k);
            }
        }
    }

    async migrateImagesOnManagedMove(file, oldPath) {
        if (!isManagedMarkdownPath(oldPath) || !isManagedMarkdownFile(file)) return;

        const oldImageBase = getManagedImageBaseForFile(oldPath);
        const newImageBase = getManagedImageBaseForFile(file.path);
        if (oldImageBase === newImageBase) return;

        const abbrlink = await this.getAbbrlinkForFile(file);
        if (!isValidAbbrlink(abbrlink)) {
            this.showPersistentNotice(`Article moved, but abbrlink is missing or invalid; images were not migrated: ${file.path}`);
            return;
        }

        try {
            const result = await this.moveManagedImageFolder(abbrlink, oldImageBase, newImageBase);

            if (result.skippedCount > 0) {
                this.showPersistentNotice(`Article moved, but ${result.skippedCount} image file(s) already existed in ${newImageBase}/${abbrlink}.`);
                return;
            }
            if (result.movedCount > 0) {
                const sourceLabel = result.sourceFolders.length === 1
                    ? result.sourceFolders[0]
                    : `${result.sourceFolders.length} locations`;
                this.showSuccessNotice(`Image folder migrated to ${newImageBase}/${abbrlink} from ${sourceLabel}`);
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.showPersistentNotice(`Article moved, but image migration failed: ${reason}`);
        }
    }

    queueManagedImageLinkRepair(file, abbrlink) {
        if (!isValidAbbrlink(abbrlink)) return;

        const existingTimer = this.imageLinkRepairTimers.get(file.path);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        const timer = setTimeout(() => {
            this.imageLinkRepairTimers.delete(file.path);
            this.restoreManagedImageLinks(file, abbrlink).catch(() => {});
        }, 300);
        this.imageLinkRepairTimers.set(file.path, timer);
    }

    async restoreManagedImageLinks(file, abbrlink) {
        if (!isManagedMarkdownFile(file) || !isValidAbbrlink(abbrlink)) return;

        const imageBase = getManagedImageBaseForFile(file.path);
        const imageFolder = this.app.vault.getAbstractFileByPath(path.join(imageBase, abbrlink));
        if (!imageFolder || !Array.isArray(imageFolder.children)) return;

        const imageNames = new Set();
        for (const child of imageFolder.children) {
            if (!Array.isArray(child.children)) {
                imageNames.add(child.name);
            }
        }
        if (imageNames.size === 0) return;

        const rewrite = (content) => {
            if (!content.includes('![')) return content;

            return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, rawTarget) => {
                const targetMatch = String(rawTarget).trim().match(/^(<[^>]+>|[^\s]+)([\s\S]*)$/);
                if (!targetMatch) return full;

                const linkTarget = targetMatch[1].replace(/^<|>$/g, '');
                const suffix = targetMatch[2] || '';
                if (!isLocalImageLink(linkTarget) || !isImagePath(linkTarget)) return full;

                let decodedTarget = linkTarget;
                try {
                    decodedTarget = decodeURIComponent(linkTarget);
                } catch (e) {}

                const imageName = path.basename(decodedTarget);
                if (!imageNames.has(imageName)) return full;

                const expectedPath = path.join(imageBase, abbrlink, imageName);
                const resolvedPath = path.normalize(path.join(path.dirname(file.path), decodedTarget));
                if (resolvedPath === expectedPath) return full;

                return `![${alt}](${buildManagedImageLink(file, abbrlink, imageName)}${suffix})`;
            });
        };

        try {
            const content = await this.app.vault.read(file);
            const updated = rewrite(content);
            if (updated !== content) {
                await this.app.vault.modify(file, updated);
            }
            this.syncOpenEditorImageLinks(file, rewrite);
        } catch (error) {
            console.error('Hexo Helper: Failed to restore relative image links', error);
        }
    }

    syncOpenEditorImageLinks(file, rewrite) {
        const workspace = this.app.workspace;
        if (!workspace || typeof workspace.getLeavesOfType !== 'function') return;

        for (const leaf of workspace.getLeavesOfType('markdown')) {
            const view = leaf?.view;
            if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;

            const editor = view.editor;
            if (!editor) continue;

            const current = editor.getValue();
            const updated = rewrite(current);
            if (updated === current) continue;

            let start = 0;
            while (start < current.length && start < updated.length && current[start] === updated[start]) {
                start++;
            }

            let currentEnd = current.length;
            let updatedEnd = updated.length;
            while (currentEnd > start && updatedEnd > start && current[currentEnd - 1] === updated[updatedEnd - 1]) {
                currentEnd--;
                updatedEnd--;
            }

            editor.replaceRange(
                updated.slice(start, updatedEnd),
                editor.offsetToPos(start),
                editor.offsetToPos(currentEnd)
            );
        }
    }

    consumePasteEvent(evt) {
        if (!evt) return;

        if (typeof evt.preventDefault === 'function') {
            evt.preventDefault();
        }
        if (typeof evt.stopPropagation === 'function') {
            evt.stopPropagation();
        }
        if (typeof evt.stopImmediatePropagation === 'function') {
            evt.stopImmediatePropagation();
        }

        evt.cancelBubble = true;
    }

    async handlePaste(evt, editor, view) {
        if (evt.defaultPrevented) return;

        const activeFile = view?.file;
        if (!isManagedMarkdownFile(activeFile)) return;

        const clipboard = evt.clipboardData;
        if (!clipboard) return;

        const items = clipboard.items || [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item.type || item.type.indexOf('image') === -1) continue;

            this.consumePasteEvent(evt);
            const blob = item.getAsFile();
            if (blob) {
                await this.processImage(blob, activeFile, editor, item.type, blob.name);
            }
            return;
        }

        const text = clipboard.getData('text/plain');
        if (!text || !text.includes('![')) return;

        const rewritten = await this.rewritePastedMarkdownImages(text, activeFile);
        if (!rewritten) return;

        this.replacePastedTextRange(editor, text, rewritten);
        this.showSuccessNotice('Pasted content images were copied into the current article folder.');
    }

    async handleDrop(evt, editor, view) {
        if (evt.defaultPrevented) return;

        const activeFile = view?.file;
        if (!isManagedMarkdownFile(activeFile)) return;

        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.type.startsWith('image/')) continue;

            this.consumePasteEvent(evt);
            await this.processImage(file, activeFile, editor, file.type, file.name);
            return;
        }
    }

    async processImage(blob, activeFile, editor, mimeType, originalName) {
        const arrayBuffer = await blob.arrayBuffer();
        const ext = normalizeImageExtension(mimeType, originalName);
        const created = await this.createManagedImageFile(arrayBuffer, activeFile, ext);
        if (!created) return;

        editor.replaceSelection(`![${created.fileName}](${created.relPath})`);
        new Notice(`Image saved: ${created.fileName}`);
    }

    async moveOrMergeFolder(sourceFolderPath, targetFolderPath) {
        if (sourceFolderPath === targetFolderPath) {
            return { movedCount: 0, skippedCount: 0, changed: false };
        }

        const sourceFolder = this.app.vault.getAbstractFileByPath(sourceFolderPath);
        if (!sourceFolder) {
            return { movedCount: 0, skippedCount: 0, changed: false };
        }

        const targetFolder = this.app.vault.getAbstractFileByPath(targetFolderPath);
        if (!targetFolder) {
            await this.app.vault.rename(sourceFolder, targetFolderPath);
            return { movedCount: 1, skippedCount: 0, changed: true };
        }

        if (!sourceFolder.children) {
            return { movedCount: 0, skippedCount: 0, changed: false };
        }

        let movedCount = 0;
        let skippedCount = 0;

        for (const child of [...sourceFolder.children]) {
            const targetChildPath = path.join(targetFolderPath, child.name);
            if (this.app.vault.getAbstractFileByPath(targetChildPath)) {
                skippedCount++;
                continue;
            }

            await this.app.vault.rename(child, targetChildPath);
            movedCount++;
        }

        if (sourceFolder.children.length === 0) {
            await this.app.vault.delete(sourceFolder, true);
        }

        return { movedCount, skippedCount, changed: movedCount > 0 };
    }

    async moveManagedImageFolder(abbrlink, sourceBaseFolder, targetBaseFolder) {
        if (!isValidAbbrlink(abbrlink)) {
            return { movedCount: 0, skippedCount: 0, changed: false, sourceFolders: [] };
        }

        const targetFolder = path.join(targetBaseFolder, abbrlink);
        let sourceFolders = [];

        if (sourceBaseFolder !== targetBaseFolder) {
            const sourceFolder = path.join(sourceBaseFolder, abbrlink);
            if (this.app.vault.getAbstractFileByPath(sourceFolder)) {
                sourceFolders = [sourceFolder];
            } else {
                sourceFolders = this.findManagedImageFolderPathsByAbbrlink(abbrlink)
                    .filter((folderPath) => folderPath !== targetFolder);
            }
        }

        if (sourceFolders.length === 0) {
            return { movedCount: 0, skippedCount: 0, changed: false, sourceFolders: [] };
        }

        await this.ensureFolderPath(targetBaseFolder);

        let movedCount = 0;
        let skippedCount = 0;
        for (const sourceFolder of sourceFolders) {
            const result = await this.moveOrMergeFolder(sourceFolder, targetFolder);
            movedCount += result.movedCount;
            skippedCount += result.skippedCount;
        }

        return { movedCount, skippedCount, changed: movedCount > 0, sourceFolders };
    }

    findManagedImageFolderPathsByAbbrlink(abbrlink) {
        const results = [];

        const visit = (folder) => {
            if (!Array.isArray(folder?.children)) return;

            for (const child of folder.children) {
                if (!Array.isArray(child.children)) continue;

                if (child.name === 'img') {
                    const candidate = child.children.find((entry) => (
                        Array.isArray(entry.children) && entry.name === abbrlink
                    ));
                    if (candidate) {
                        results.push(candidate.path);
                    }
                    continue;
                }

                visit(child);
            }
        };

        for (const rootPath of [POSTS_ROOT, DRAFTS_ROOT]) {
            const root = this.app.vault.getAbstractFileByPath(rootPath);
            if (root) {
                visit(root);
            }
        }

        return results;
    }

    async publishManagedFile(file) {
        if (!(file instanceof TFile) || !isDraftFile(file)) return;

        const targetPath = path.join(POSTS_ROOT, file.name);
        if (this.app.vault.getAbstractFileByPath(targetPath)) {
            this.showPersistentNotice(`Publish aborted, target file already exists: ${targetPath}`);
            return;
        }

        const abbrlink = await this.getAbbrlinkForFile(file);
        const sourceImageBase = getManagedImageBaseForFile(file.path);
        const targetImageBase = getManagedImageBaseForFile(targetPath);
        const needsImageMove = sourceImageBase !== targetImageBase;

        if (needsImageMove && !isValidAbbrlink(abbrlink)) {
            this.showPersistentNotice(`Publish aborted, abbrlink is missing or invalid: ${file.path}`);
            return;
        }

        this.programmaticImageMoves.add(targetPath);
        try {
            await this.ensureFolderPath(POSTS_ROOT);
            await this.app.vault.rename(file, targetPath);
            const imageMoveResult = needsImageMove
                ? await this.moveManagedImageFolder(abbrlink, sourceImageBase, targetImageBase)
                : { movedCount: 0, skippedCount: 0, changed: false };
            if (isValidAbbrlink(abbrlink)) {
                this.queueManagedImageLinkRepair(file, abbrlink);
            }

            if (imageMoveResult.skippedCount > 0) {
                this.showPersistentNotice(`Article published, but ${imageMoveResult.skippedCount} image file(s) already existed in ${targetImageBase}/${abbrlink}.`);
                return;
            }

            this.showSuccessNotice(`Published to blog: ${targetPath}`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.showPersistentNotice(`Publish failed: ${reason}`);
        } finally {
            this.programmaticImageMoves.delete(targetPath);
        }
    }

    async privatizeManagedFile(file) {
        if (!(file instanceof TFile) || !isPostFile(file)) return;

        const targetPath = path.join(PRIVATE_DRAFTS_ROOT, file.name);
        if (this.app.vault.getAbstractFileByPath(targetPath)) {
            this.showPersistentNotice(`Privatize aborted, target file already exists: ${targetPath}`);
            return;
        }

        const abbrlink = await this.getAbbrlinkForFile(file);
        const sourceImageBase = getManagedImageBaseForFile(file.path);
        const targetImageBase = getManagedImageBaseForFile(targetPath);
        const needsImageMove = sourceImageBase !== targetImageBase;

        if (needsImageMove && !isValidAbbrlink(abbrlink)) {
            this.showPersistentNotice(`Privatize aborted, abbrlink is missing or invalid: ${file.path}`);
            return;
        }

        this.programmaticImageMoves.add(targetPath);
        try {
            await this.ensureFolderPath(PRIVATE_DRAFTS_ROOT);
            await this.app.vault.rename(file, targetPath);
            const imageMoveResult = needsImageMove
                ? await this.moveManagedImageFolder(abbrlink, sourceImageBase, targetImageBase)
                : { movedCount: 0, skippedCount: 0, changed: false };
            if (isValidAbbrlink(abbrlink)) {
                this.queueManagedImageLinkRepair(file, abbrlink);
            }

            if (imageMoveResult.skippedCount > 0) {
                this.showPersistentNotice(`Article privatized, but ${imageMoveResult.skippedCount} image file(s) already existed in ${targetImageBase}/${abbrlink}.`);
                return;
            }

            this.showSuccessNotice(`Moved to private drafts: ${targetPath}`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.showPersistentNotice(`Privatize failed: ${reason}`);
        } finally {
            this.programmaticImageMoves.delete(targetPath);
        }
    }

    async copyHexoLink(file, editor) {
        const cache = this.app.metadataCache.getFileCache(file);
        let abbrlink = null;
        if (cache && cache.frontmatter && cache.frontmatter.abbrlink) {
            abbrlink = cache.frontmatter.abbrlink;
        } else {
            new Notice('This file has no abbrlink!');
            return;
        }

        let linkText = `[${formatMarkdownLinkLabel(file.basename)}](/posts/${abbrlink}/)`;

        if (editor) {
            const cursor = editor.getCursor();
            const lineContent = editor.getLine(cursor.line);
            const headerMatch = lineContent.match(/^(#+)\s+(.*)/);
            if (headerMatch) {
                const header = headerMatch[2].trim();
                const hash = getHexoSlugForHeadingLine(cache, cursor.line, header);
                const linkLabel = formatMarkdownLinkLabel(header);
                linkText = `[${linkLabel}](/posts/${abbrlink}/#${hash})`;
            }
        }

        await navigator.clipboard.writeText(linkText);
        new Notice('Hexo Link copied to clipboard!');
    }
};
