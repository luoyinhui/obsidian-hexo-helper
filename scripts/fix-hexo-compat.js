// Hexo Filter to fix compatibility issues between Obsidian and Hexo

hexo.extend.filter.register('before_post_render', function(data){
  
  // --- 1. Image Path Fix ---
  // Obsidian: ![](../img/PostName/Img.png)
  // Hexo (Web): ![](/img/PostName/Img.png)
  // Matches ../img/ and ../../img/
  data.content = data.content.replace(/!\[(.*?)\]\(\.\.\/img\/(.*?)\)/g, '![$1](/img/$2)');
  data.content = data.content.replace(/!\[(.*?)\]\(\.\.\/\.\.\/img\/(.*?)\)/g, '![$1](/img/$2)');

  // --- 2. PDF Fix ---
  // Obsidian: ![[filename.pdf]]
  // Hexo Target: <iframe src="/js/pdfjs/web/viewer.html?file=/pdf/filename.pdf" width="100%" height="600px"></iframe>
  // Logic: Match ![[xxx.pdf]] and replace with iframe code.
  // Note: We assume the PDF is in /pdf/ (mapped from source/pdf)
  
  data.content = data.content.replace(/!\[\[(.*?\.pdf)\]\]/g, function(match, filename){
      // Verify if filename has path. Obsidian ![[path/to/file.pdf]] -> filename is path/to/file.pdf
      // If user just dropped it, it might be just filename.
      // We assume all PDFs are served at /pdf/filename
      const baseName = filename.split('/').pop(); 
      return `<iframe src="/js/pdfjs/web/viewer.html?file=/pdf/${baseName}" width="100%" height="600px"></iframe>`;
  });

  // --- 3. Anchor Slugize Fix ---
  // Obsidian: [Title](/posts/abbrlink/#Title%20Text)
  // Hexo Target: [Title](/posts/abbrlink/#title-text)
  // Logic: Match links with /posts/ and #, then slugize the hash part.
  data.content = data.content.replace(/(\[.*?\])\((\/posts\/[a-zA-Z0-9]+\/)(#[^)]*)\)/g, function(match, text, path, hash){
      // hash includes #
      let anchor = hash.substring(1); // remove #
      
      try {
          anchor = decodeURIComponent(anchor);
      } catch (e) {
          // ignore error
      }

      // Hexo slugize simulation (simplified from hexo-util)
      // 1. Lowercase
      // 2. Replace special chars with -
      // 3. Trim -
      
      const rSpecial = /[\s\~\`\!\@\#\$\%\^\&\*\(\)\-\_\=\+\[\{\]\}\\\|\;\:\'\"\,\<\.\>\/\?]+/g;
      
      anchor = anchor.toLowerCase();
      anchor = anchor.replace(rSpecial, '-');
      anchor = anchor.replace(/-+/g, '-'); // Merge dashes
      anchor = anchor.replace(/^-+|-+$/g, ''); // Trim dashes
      
      if (anchor.length === 0) anchor = '';
      
      return `${text}(${path}#${anchor})`;
  });

  return data;
});
