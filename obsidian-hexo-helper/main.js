const { Plugin, Notice, TFile, Menu } = require('obsidian');

const IMG_FOLDER_BASE = 'source/img';

// CRC32 Implementation
const makeCRCTable = () => {
    let c;
    const crcTable = [];
    for(let n =0; n < 256; n++){
        c = n;
        for(let k =0; k < 8; k++){
            c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[n] = c;
    }
    return crcTable;
}
const crcTable = makeCRCTable();
const crc32 = (str) => {
    let crc = 0 ^ (-1);
    for (let i = 0; i < str.length; i++ ) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
};

module.exports = class HexoHelperPlugin extends Plugin {
    async onload() {
        console.log('Loading Hexo Helper Plugin (V7 - Simplified)');

        // 1. Build Abbrlink Map
        this.abbrlinkMap = new Map();
        this.app.workspace.onLayoutReady(() => {
            this.buildAbbrlinkMap();
        });
        
        // 2. Monkey Patch openLinkText to intercept /posts/abbrlink navigation
        this.originalOpenLinkText = this.app.workspace.openLinkText;
        this.app.workspace.openLinkText = async (linktext, sourcePath, newLeaf, openViewState) => {
            if (linktext && (linktext.startsWith('/posts/') || linktext.startsWith('posts/'))) {
                try {
                    // Extract abbrlink and hash
                    const match = linktext.match(/(?:\/)?posts\/([a-zA-Z0-9]+)\/?(#.*)?/);
                    if (match && match[1]) {
                        const abbrlink = match[1];
                        let hash = match[2] || '';
                        
                        // Decode hash
                        if (hash) {
                            try { hash = decodeURIComponent(hash); } catch(e) {}
                        }

                        const filePath = this.abbrlinkMap.get(abbrlink);
                        if (filePath) {
                            // Redirect to real file path
                            const realLinkText = filePath + hash;
                            return this.originalOpenLinkText.call(this.app.workspace, realLinkText, filePath, newLeaf, openViewState);
                        }
                    }
                } catch (e) {
                    console.error("Hexo Helper: Error intercepting openLinkText", e);
                }
            }
            return this.originalOpenLinkText.call(this.app.workspace, linktext, sourcePath, newLeaf, openViewState);
        };

        this.registerEvent(this.app.vault.on('modify', (file) => {
            if(file.path.startsWith('source/_posts') && file.extension === 'md') this.updateAbbrlinkMap(file);
        }));

        this.registerEvent(this.app.vault.on('create', async (file) => {
            if(file.path.startsWith('source/_posts') && file.extension === 'md') {
                this.updateAbbrlinkMap(file);
                setTimeout(async () => {
                    const content = await this.app.vault.read(file);
                    if (!content || content.trim() === '') {
                        await this.applyHexoTemplate(file);
                    }
                }, 100);
            }
        }));

        // 4. Paste Handler (Updated for ../img/)
        this.registerEvent(
            this.app.workspace.on('editor-paste', async (evt, editor, view) => {
                await this.handlePaste(evt, editor, view);
            })
        );
        
        // 3. Drop Handler
        this.registerEvent(
            this.app.workspace.on('editor-drop', async (evt, editor, view) => {
                await this.handleDrop(evt, editor, view);
            })
        );

        // 4. Context Menu (Editor)
        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, view) => {
                menu.addItem((item) => {
                    item.setTitle("Copy Hexo Link").setIcon("link").onClick(() => this.copyHexoLink(view.file, editor));
                });
            })
        );

        // 5. Context Menu (File Explorer)
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    menu.addItem((item) => {
                        item.setTitle("Copy Hexo Link").setIcon("link").onClick(() => this.copyHexoLink(file, null));
                    });
                }
            })
        );
    }

    onunload() {
        if (this.originalOpenLinkText) {
            this.app.workspace.openLinkText = this.originalOpenLinkText;
        }
    }

    // REMOVED: handleGlobalClick (No longer needed with Monkey Patch)
    // handleGlobalClick(evt) { ... }

    async applyHexoTemplate(file) {
        const title = file.basename;
        const date = window.moment().format('YYYY-MM-DD HH:mm:ss');
        const abbrlinkSource = title + date;
        const abbrlink = crc32(abbrlinkSource).toString(16);

        const template = `---
title: ${title}
date: ${date}
tags: 
categories: 
description: 
swiper_index: 
abbrlink: ${abbrlink}
---

`;
        await this.app.vault.modify(file, template);
        new Notice('Hexo Front-matter applied!');
    }

    async buildAbbrlinkMap() {
        this.abbrlinkMap.clear();
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            if (file.path.startsWith('source/_posts')) {
                await this.updateAbbrlinkMap(file);
            }
        }
        console.log(`[Hexo Helper] Indexed ${this.abbrlinkMap.size} posts.`);
    }

    async updateAbbrlinkMap(file) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache && cache.frontmatter && cache.frontmatter.abbrlink) {
            for (const [k, v] of this.abbrlinkMap) {
                if (v === file.path) this.abbrlinkMap.delete(k);
            }
            this.abbrlinkMap.set(String(cache.frontmatter.abbrlink), file.path);
        }
    }

    async handlePaste(evt, editor, view) {
        const activeFile = view.file;
        if (!activeFile || activeFile.extension !== 'md') return;
        // Strict check: Only process files in source/_posts
        if (activeFile.path.indexOf('source/_posts') === -1) return;

        const items = evt.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            if (item.type.indexOf("image") !== -1) {
                evt.preventDefault();
                const blob = item.getAsFile();
                if (blob) {
                    await this.processImage(blob, activeFile, editor, item.type, blob.name);
                }
                return; // Stop after handling first image
            }
        }
    }

    async handleDrop(evt, editor, view) {
        const activeFile = view.file;
        if (!activeFile || activeFile.extension !== 'md') return;
        if (activeFile.path.indexOf('source/_posts') === -1) return;

        const files = evt.dataTransfer.files;
        if (files && files.length > 0) {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.type.startsWith('image/')) {
                    evt.preventDefault();
                    await this.processImage(file, activeFile, editor, file.type, file.name);
                    return; // Stop after first image
                }
            }
        }
    }

    async processImage(blob, activeFile, editor, mimeType, originalName) {
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = arrayBuffer;

        let ext = 'png';
        if (mimeType) {
            const parts = mimeType.split("/");
            if (parts.length === 2) {
                ext = parts[1];
                if (ext === 'jpeg') ext = 'jpg';
            }
        }
        if (originalName && originalName.lastIndexOf('.') !== -1) {
            const parts = originalName.split('.');
            const potentialExt = parts[parts.length - 1];
            if (potentialExt && potentialExt.length > 0 && potentialExt.length < 6) ext = potentialExt;
        }
        if (!ext || ext === 'undefined') ext = 'png';

        // Use activeFile.basename but replace spaces with underscores as requested
        const postName = activeFile.basename.replace(/\s+/g, '_');
        const targetFolder = `${IMG_FOLDER_BASE}/${postName}`;
        
        if (!this.app.vault.getAbstractFileByPath('source/img')) {
            await this.app.vault.createFolder('source/img');
        }
        if (!this.app.vault.getAbstractFileByPath(targetFolder)) {
            await this.app.vault.createFolder(targetFolder);
        }

        let index = 1;
        while (true) {
            // Filename format: {PostName}_image-{index}.{ext}
            const candidateName = `${postName}_image-${index}.${ext}`;
            const candidatePath = `${targetFolder}/${candidateName}`;
            if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
                await this.app.vault.createBinary(candidatePath, buffer);
                // Use relative path ../img/...
                const relPath = `../img/${postName}/${candidateName}`;
                editor.replaceSelection(`![${candidateName}](${relPath})`);
                new Notice(`Image saved: ${candidateName}`);
                break;
            }
            index++;
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
        let linkText = `[${file.basename}](/posts/${abbrlink}/)`;
        
        // If triggered from editor context menu and cursor is on header, use header anchor
        if (editor) {
            const cursor = editor.getCursor();
            const lineContent = editor.getLine(cursor.line);
            const headerMatch = lineContent.match(/^(#+)\s+(.*)/);
            if (headerMatch) {
                // Remove trailing spaces
                const header = headerMatch[2].trim();
                // We just append the header text directly as hash. 
                // Hexo usually needs it raw (or encoded? usually raw works in markdown)
                linkText = `[${file.basename}](/posts/${abbrlink}/#${header})`;
            }
        }
        
        await navigator.clipboard.writeText(linkText);
        new Notice('Hexo Link copied to clipboard!');
    }
}