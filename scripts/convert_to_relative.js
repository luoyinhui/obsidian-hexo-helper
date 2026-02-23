const fs = require('fs');
const path = require('path');

// Target directory
// NOTE: Adjust this path if you run the script from a different location
const postsDir = path.join(__dirname, '../source/_posts');

console.log(`Scanning directory: ${postsDir}`);

if (!fs.existsSync(postsDir)) {
    console.error(`Directory not found: ${postsDir}`);
    console.error(`Please ensure this script is placed in your blog's 'scripts' folder or adjust the path in the script.`);
    process.exit(1);
}

let totalFiles = 0;
let modifiedFiles = 0;

function processDirectory(directory) {
    const files = fs.readdirSync(directory);
    
    files.forEach(file => {
        const fullPath = path.join(directory, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            processDirectory(fullPath);
        } else if (file.endsWith('.md')) {
            totalFiles++;
            let content = fs.readFileSync(fullPath, 'utf8');
            let originalContent = content;
            
            // Regex to match ![alt](/img/...)
            // Captures: 1=alt, 2=path after /img/
            const regex = /!\[([^\]]*)\]\(\/img\/([^)]+)\)/g;
            
            if (regex.test(content)) {
                // Replace with ![alt](../img/...)
                content = content.replace(regex, '![$1](../img/$2)');
                
                if (content !== originalContent) {
                    fs.writeFileSync(fullPath, content, 'utf8');
                    console.log(`[UPDATED] ${file}`);
                    modifiedFiles++;
                }
            }
        }
    });
}

processDirectory(postsDir);

console.log('--------------------------------------------------');
console.log(`Scan complete.`);
console.log(`Total Markdown files scanned: ${totalFiles}`);
console.log(`Files updated: ${modifiedFiles}`);
console.log('--------------------------------------------------');
