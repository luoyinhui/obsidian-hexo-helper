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

        // 2. Paste Handler (Updated for ../img/)
        this.registerEvent(
            this.app.workspace.on('editor-paste', async (evt, editor, view) => {
                await this.handlePaste(evt, editor, view);
            })
        );

        // 3. Global Click Interceptor (Link Fix)
        this.registerDomEvent(document, 'click', (evt) => {
            this.handleGlobalClick(evt);
        }, { capture: true });
        
        // 4. Context Menu
        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, view) => {
                menu.addItem((item) => {
                    item.setTitle("Copy Hexo Link").setIcon("link").onClick(() => this.copyHexoLink(view.file, editor));
                });
            })
        );
    }

    handleGlobalClick(evt) {
        const target = evt.target;
        if (!target) return;

        let linkElement = target;
        for (let i = 0; i < 3; i++) {
            if (!linkElement) break;
            if (linkElement.tagName === 'A') break;
            if (linkElement.getAttribute && linkElement.getAttribute('data-href')) break;
            linkElement = linkElement.parentElement;
        }

        if (!linkElement) return;

        let href = linkElement.getAttribute('href') || linkElement.getAttribute('data-href');
        
        if (href && (href.startsWith('/posts/') || href.startsWith('posts/'))) {
            const match = href.match(/(?:\/)?posts\/([a-zA-Z0-9]+)\/?(#.*)?/);
            if (match && match[1]) {
                const abbrlink = match[1];
                const hash = match[2] || '';
                const filePath = this.abbrlinkMap.get(abbrlink);
                
                if (filePath) {
                    evt.preventDefault();
                    evt.stopPropagation();
                    this.app.workspace.openLinkText(filePath + hash, '', false);
                }
            }
        }
    }

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
            this.abbrlinkMap.set(String(cache.frontmatter.abbrlink), file.path);
        }
    }

    async handlePaste(evt, editor, view) {
        const activeFile = view.file;
        if (!activeFile || activeFile.extension !== 'md') return;
        if (!activeFile.path.includes('source/_posts')) return;

        const items = evt.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            if (item.type.indexOf("image") !== -1) {
                evt.preventDefault();
                const blob = item.getAsFile();
                const arrayBuffer = await blob.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                
                let ext = 'png';
                if (item.type) {
                    const parts = item.type.split("/");
                    if (parts.length === 2) {
                        ext = parts[1];
                        if (ext === 'jpeg') ext = 'jpg';
                    }
                }
                if (blob.name && blob.name.lastIndexOf('.') !== -1) {
                    const parts = blob.name.split('.');
                    const potentialExt = parts[parts.length - 1];
                    if (potentialExt && potentialExt.length > 0 && potentialExt.length < 6) ext = potentialExt;
                }
                if (!ext || ext === 'undefined') ext = 'png';

                const postName = activeFile.basename;
                const targetFolder = `${IMG_FOLDER_BASE}/${postName}`;
                
                if (!this.app.vault.getAbstractFileByPath(targetFolder)) {
                    await this.app.vault.createFolder(targetFolder);
                }

                let index = 1;
                while (true) {
                    const candidateName = `${postName}_image-${index}.${ext}`;
                    const candidatePath = `${targetFolder}/${candidateName}`;
                    if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
                        await this.app.vault.createBinary(candidatePath, buffer);
                        // CHANGED: Use relative path ../img/...
                        const relPath = `../img/${postName}/${candidateName}`;
                        editor.replaceSelection(`![${candidateName}](${relPath})`);
                        new Notice(`Image saved: ${candidateName}`);
                        break;
                    }
                    index++;
                }
                return;
            }
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
        if (editor) {
            const cursor = editor.getCursor();
            const lineContent = editor.getLine(cursor.line);
            const headerMatch = lineContent.match(/^(#+)\s+(.*)/);
            if (headerMatch) linkText = `[${file.basename}](/posts/${abbrlink}/#${headerMatch[2]})`;
        }
        await navigator.clipboard.writeText(linkText);
        new Notice('Hexo Link copied to clipboard!');
    }
}
