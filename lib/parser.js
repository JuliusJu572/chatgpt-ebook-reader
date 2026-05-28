/**
 * 统一电子书解析器
 * 支持 PDF、EPUB、TXT 格式
 */

const EbookParser = (() => {

  // ===== TXT 解析 =====
  async function parseTXT(file) {
    const text = await file.text();
    return {
      title: file.name.replace(/\.txt$/i, ''),
      rawText: text,
      totalChars: text.length
    };
  }

  // ===== PDF 解析 =====
  async function parsePDF(file) {
    // 设置 PDF.js worker 路径
    if (typeof pdfjsLib !== 'undefined' && typeof chrome !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n\n';
    }

    return {
      title: file.name.replace(/\.pdf$/i, ''),
      rawText: fullText.trim(),
      totalChars: fullText.trim().length
    };
  }

  // ===== EPUB 解析 =====
  async function parseEPUB(file) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 读取 container.xml 找到 rootfile
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) throw new Error('无效的 EPUB 文件：缺少 container.xml');

    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'application/xml');
    const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
    if (!rootfilePath) throw new Error('无效的 EPUB 文件：缺少 rootfile');

    // 读取 OPF 文件获取阅读顺序
    const opfContent = await zip.file(rootfilePath)?.async('string');
    if (!opfContent) throw new Error('无效的 EPUB 文件：无法读取 OPF');

    const opfDoc = parser.parseFromString(opfContent, 'application/xml');
    const opfDir = rootfilePath.includes('/') ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1) : '';

    // 获取 manifest 中的所有项
    const manifestItems = {};
    opfDoc.querySelectorAll('manifest item').forEach(item => {
      manifestItems[item.getAttribute('id')] = item.getAttribute('href');
    });

    // 按 spine 顺序读取内容
    const spineItems = opfDoc.querySelectorAll('spine itemref');
    let fullText = '';

    for (const itemRef of spineItems) {
      const idref = itemRef.getAttribute('idref');
      const href = manifestItems[idref];
      if (!href) continue;

      const filePath = opfDir + href;
      const content = await zip.file(filePath)?.async('string');
      if (!content) continue;

      // 从 XHTML 提取纯文本
      const doc = parser.parseFromString(content, 'application/xhtml+xml');
      const body = doc.querySelector('body');
      if (body) {
        fullText += extractTextFromNode(body) + '\n\n';
      }
    }

    // 尝试从 OPF 获取标题
    let title = opfDoc.querySelector('metadata dc\\:title, metadata title')?.textContent;
    if (!title) title = file.name.replace(/\.epub$/i, '');

    return {
      title,
      rawText: fullText.trim(),
      totalChars: fullText.trim().length
    };
  }

  // 从 DOM 节点递归提取文本，转换为 Markdown 格式
  function extractTextFromNode(node) {
    let text = '';

    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        const inner = extractTextFromNode(child).trim();
        if (!inner && tag !== 'br' && tag !== 'hr') continue;

        switch (tag) {
          case 'h1': text += `\n\n# ${inner}\n\n`; break;
          case 'h2': text += `\n\n## ${inner}\n\n`; break;
          case 'h3': text += `\n\n### ${inner}\n\n`; break;
          case 'h4': text += `\n\n#### ${inner}\n\n`; break;
          case 'h5': text += `\n\n##### ${inner}\n\n`; break;
          case 'h6': text += `\n\n###### ${inner}\n\n`; break;
          case 'p':
          case 'div': text += `\n\n${inner}\n\n`; break;
          case 'br': text += '\n'; break;
          case 'hr': text += '\n\n---\n\n'; break;
          case 'li': text += `\n- ${inner}`; break;
          case 'ul':
          case 'ol': text += `\n${inner}\n\n`; break;
          case 'blockquote': text += `\n\n> ${inner.replace(/\n/g, '\n> ')}\n\n`; break;
          case 'strong':
          case 'b': text += `**${inner}**`; break;
          case 'em':
          case 'i': text += `*${inner}*`; break;
          case 'sup': text += `[${inner}]`; break;
          default: text += inner;
        }
      }
    }

    return text;
  }

  // ===== 统一入口 =====
  async function parse(file) {
    const name = file.name.toLowerCase();

    let result;
    if (name.endsWith('.txt')) {
      result = await parseTXT(file);
    } else if (name.endsWith('.pdf')) {
      result = await parsePDF(file);
    } else if (name.endsWith('.epub')) {
      result = await parseEPUB(file);
    } else {
      throw new Error(`不支持的文件格式: ${file.name}`);
    }

    return result;
  }

  // 文本分页
  function splitIntoPages(text, charsPerPage = 2000) {
    const pages = [];
    let i = 0;
    while (i < text.length) {
      let end = Math.min(i + charsPerPage, text.length);
      if (end < text.length) {
        const slice = text.substring(i, end);
        const lastPara = slice.lastIndexOf('\n\n');
        const lastNewline = slice.lastIndexOf('\n');
        const lastPeriod = Math.max(
          slice.lastIndexOf('。'),
          slice.lastIndexOf('.'),
          slice.lastIndexOf('！'),
          slice.lastIndexOf('？')
        );

        if (lastPara > charsPerPage * 0.5) {
          end = i + lastPara + 2;
        } else if (lastNewline > charsPerPage * 0.5) {
          end = i + lastNewline + 1;
        } else if (lastPeriod > charsPerPage * 0.5) {
          end = i + lastPeriod + 1;
        }
      }

      const page = text.substring(i, end).trim();
      if (page) pages.push(page);
      i = end;
    }
    return pages;
  }

  return { parse, splitIntoPages };
})();
