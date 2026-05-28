/**
 * 统一电子书解析器
 * 支持 PDF、EPUB、TXT 格式
 */

const EbookParser = (() => {
  const PARSER_VERSION = 2;
  const BLOCK_TAGS = new Set(['p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

  // ===== TXT 解析 =====
  async function parseTXT(file) {
    const text = await file.text();
    const title = file.name.replace(/\.txt$/i, '');
    const segments = createSegmentsFromText(text, { spineIndex: 0, href: file.name });

    return buildParsedResult({
      title,
      rawText: text,
      segments,
      spine: [{ spineIndex: 0, href: file.name, mediaType: 'text/plain' }],
      toc: []
    });
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

    const rawText = fullText.trim();
    const title = file.name.replace(/\.pdf$/i, '');
    const segments = createSegmentsFromText(rawText, { spineIndex: 0, href: file.name });

    return buildParsedResult({
      title,
      rawText,
      segments,
      spine: [{ spineIndex: 0, href: file.name, mediaType: 'application/pdf' }],
      toc: []
    });
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
    const rootfilePath = firstByLocalName(containerDoc, 'rootfile')?.getAttribute('full-path');
    if (!rootfilePath) throw new Error('无效的 EPUB 文件：缺少 rootfile');

    // 读取 OPF 文件获取阅读顺序
    const opfContent = await readZipText(zip, rootfilePath);
    if (!opfContent) throw new Error('无效的 EPUB 文件：无法读取 OPF');

    const opfDoc = parser.parseFromString(opfContent, 'application/xml');
    const opfDir = dirname(rootfilePath);

    // 获取 manifest 中的所有项
    const manifestItems = {};
    elementsByLocalName(opfDoc, 'item').forEach(item => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (!id || !href) return;
      manifestItems[id] = {
        id,
        href,
        mediaType: item.getAttribute('media-type') || '',
        properties: item.getAttribute('properties') || '',
        path: resolvePath(opfDir, href)
      };
    });

    // 按 spine 顺序读取内容
    const spine = [];
    const segments = [];
    const itemRefs = elementsByLocalName(opfDoc, 'itemref');

    itemRefs.forEach((itemRef, spineIndex) => {
      const idref = itemRef.getAttribute('idref');
      const item = manifestItems[idref];
      if (!item) return;
      spine.push({
        spineIndex,
        idref,
        href: item.path,
        mediaType: item.mediaType
      });
    });

    for (const spineItem of spine) {
      const content = await readZipText(zip, spineItem.href);
      if (!content) continue;

      const doc = parseXhtml(content);
      const body = firstByLocalName(doc, 'body');
      if (!body) continue;

      const spineSegments = extractSegmentsFromBody(body, spineItem);
      segments.push(...spineSegments);
    }

    finalizeSegmentChars(segments);

    const toc = resolveTocTargets(await parseTocFilesAsync(zip, manifestItems), segments);

    // 尝试从 OPF 获取标题
    let title = null;
    const titleEl = elementsByLocalName(opfDoc, 'title')[0];
    if (titleEl) title = normalizeWhitespace(titleEl.textContent);
    if (!title) title = file.name.replace(/\.epub$/i, '');

    return buildParsedResult({
      title,
      rawText: segments.map(formatSegmentText).join('\n\n'),
      segments,
      spine,
      toc
    });
  }

  // ===== DOM/路径工具 =====

  function parseXhtml(content) {
    const parser = new DOMParser();
    let doc = parser.parseFromString(content, 'application/xhtml+xml');
    if (firstByLocalName(doc, 'parsererror')) {
      doc = parser.parseFromString(content, 'text/html');
    }
    return doc;
  }

  function elementsByLocalName(root, localName) {
    return Array.from(root.getElementsByTagName('*'))
      .filter(el => el.localName === localName || el.tagName?.toLowerCase() === localName);
  }

  function firstByLocalName(root, localName) {
    return elementsByLocalName(root, localName)[0] || null;
  }

  function dirname(path) {
    const normalized = path.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.substring(0, idx + 1) : '';
  }

  function resolvePath(baseDir, href) {
    const cleanHref = safeDecodeURIComponent(String(href || '').split('#')[0]).replace(/\\/g, '/');
    const parts = `${baseDir || ''}${cleanHref}`.split('/');
    const stack = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return stack.join('/');
  }

  function splitHref(href) {
    const raw = String(href || '');
    const [filePart, fragment] = raw.split('#');
    return { filePart, fragment: fragment ? safeDecodeURIComponent(fragment) : null };
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (_) {
      return value;
    }
  }

  async function readZipText(zip, path) {
    const file = zip.file(path) || zip.file(safeDecodeURIComponent(path));
    return file ? file.async('string') : null;
  }

  // ===== EPUB 内容结构提取 =====

  function extractSegmentsFromBody(body, spineItem) {
    const segments = [];
    const source = {
      spineIndex: spineItem.spineIndex,
      href: spineItem.href,
      nextIndex: 0,
      segments
    };

    walkReadableElements(body, source);
    return segments;
  }

  function walkReadableElements(element, source) {
    if (element.nodeType !== Node.ELEMENT_NODE) return;

    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'nav') return;

    const before = source.segments.length;

    if (tag === 'hr') {
      emitSegment(source, element, 'separator', 0, '---');
    } else if (shouldEmitAsSegment(element)) {
      const kind = getSegmentKind(element);
      const level = kind === 'heading' ? getHeadingLevel(element) : 0;
      const text = extractReadableText(element);
      emitSegment(source, element, kind, level, text);
    } else {
      Array.from(element.children).forEach(child => walkReadableElements(child, source));
    }

    const anchors = getElementAnchors(element);
    if (anchors.length && source.segments.length > before) {
      anchors.forEach(anchor => addAnchor(source.segments[before], anchor));
    }
  }

  function shouldEmitAsSegment(element) {
    const tag = element.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) return true;
    if (tag !== 'div') return false;
    if (hasChildSegmentBlock(element)) return false;
    return !!extractReadableText(element);
  }

  function hasChildSegmentBlock(element) {
    return Array.from(element.children).some(child => {
      const tag = child.tagName.toLowerCase();
      if (BLOCK_TAGS.has(tag)) return true;
      if (tag === 'div' && !hasChildSegmentBlock(child) && !!extractReadableText(child)) return true;
      return hasChildSegmentBlock(child);
    });
  }

  function getSegmentKind(element) {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'li') return 'listItem';
    if (tag === 'blockquote') return 'blockquote';
    if (tag === 'div' && detectHeadingLevel(element) > 0) return 'heading';
    return 'paragraph';
  }

  // 检测 <p>/<div> 是否通过 CSS class 暗示为标题
  function detectHeadingLevel(element) {
    const className = (element.getAttribute('class') || '');
    if (/chapter|part/i.test(className)) return 2;
    if (/title|heading/i.test(className)) return 3;
    return 0;
  }

  function getHeadingLevel(element) {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return parseInt(tag.substring(1), 10);
    return detectHeadingLevel(element) || 3;
  }

  function emitSegment(source, element, kind, level, text) {
    const normalizedText = kind === 'separator' ? '---' : normalizeWhitespace(text);
    if (!normalizedText) return;

    const paragraphIndexInSpine = source.nextIndex++;
    const segment = {
      locId: `${source.spineIndex}:${paragraphIndexInSpine}`,
      spineIndex: source.spineIndex,
      href: source.href,
      elementId: null,
      anchorIds: [],
      paragraphIndexInSpine,
      kind,
      level,
      text: normalizedText,
      charStart: 0,
      charEnd: 0
    };

    getElementAnchors(element).forEach(anchor => addAnchor(segment, anchor));
    source.segments.push(segment);
  }

  function getElementAnchors(element) {
    return ['id', 'name']
      .map(attr => element.getAttribute(attr))
      .filter(Boolean);
  }

  function addAnchor(segment, anchor) {
    if (!segment.anchorIds.includes(anchor)) {
      segment.anchorIds.push(anchor);
    }
    if (!segment.elementId) {
      segment.elementId = anchor;
    }
  }

  function extractReadableText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return '';
    if (tag === 'br') return '\n';
    if (tag === 'img') return node.getAttribute('alt') || '';

    return Array.from(node.childNodes).map(extractReadableText).join('');
  }

  function normalizeWhitespace(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .trim();
  }

  function finalizeSegmentChars(segments) {
    let pos = 0;
    segments.forEach((segment, index) => {
      if (index > 0) pos += 2; // join('\n\n')
      const text = formatSegmentText(segment);
      segment.charStart = pos;
      pos += text.length;
      segment.charEnd = pos;
    });
  }

  // ===== TOC 解析与定位 =====

  async function parseTocFilesAsync(zip, manifestItems) {
    const toc = [];
    const parser = new DOMParser();

    const ncxItems = Object.values(manifestItems).filter(item =>
      item.mediaType === 'application/x-dtbncx+xml' || /\.ncx$/i.test(item.href)
    );
    for (const item of ncxItems) {
      const text = await readZipText(zip, item.path);
      if (!text) continue;
      const doc = parser.parseFromString(text, 'application/xml');
      const baseDir = dirname(item.path);
      elementsByLocalName(doc, 'navPoint').forEach((navPoint, index) => {
        const label = normalizeWhitespace(firstByLocalName(navPoint, 'text')?.textContent || '');
        const src = firstByLocalName(navPoint, 'content')?.getAttribute('src');
        if (!src) return;
        const { filePart, fragment } = splitHref(src);
        toc.push({
          id: `ncx-${index}`,
          label,
          href: resolvePath(baseDir, filePart),
          fragment,
          locId: null,
          pageIndex: null
        });
      });
    }

    const navItems = Object.values(manifestItems).filter(item =>
      item.properties.split(/\s+/).includes('nav')
    );
    for (const item of navItems) {
      const text = await readZipText(zip, item.path);
      if (!text) continue;
      const doc = parseXhtml(text);
      const baseDir = dirname(item.path);
      elementsByLocalName(doc, 'a').forEach((a, index) => {
        const href = a.getAttribute('href');
        if (!href) return;
        const { filePart, fragment } = splitHref(href);
        toc.push({
          id: `nav-${index}`,
          label: normalizeWhitespace(a.textContent || ''),
          href: resolvePath(baseDir, filePart),
          fragment,
          locId: null,
          pageIndex: null
        });
      });
    }

    return toc;
  }

  function resolveTocTargets(toc, segments) {
    const byHref = new Map();
    segments.forEach(segment => {
      if (!byHref.has(segment.href)) byHref.set(segment.href, []);
      byHref.get(segment.href).push(segment);
    });

    return toc.map(item => {
      const hrefSegments = byHref.get(item.href) || [];
      let target = null;
      if (item.fragment) {
        target = hrefSegments.find(segment =>
          segment.elementId === item.fragment || segment.anchorIds.includes(item.fragment)
        );
      }
      if (!target) target = hrefSegments[0] || null;
      return {
        ...item,
        spineIndex: target ? target.spineIndex : null,
        locId: target ? target.locId : null
      };
    });
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

  // 文本分页：新书按 segment 边界分页；旧文本保留兼容逻辑
  function splitIntoPages(input, charsPerPage = 2000) {
    if (typeof input === 'string') {
      return splitTextIntoPages(input, charsPerPage);
    }

    const bookLike = input || {};
    const hasSegments = Array.isArray(bookLike.segments) && bookLike.segments.length;
    const segments = hasSegments
      ? bookLike.segments
      : createSegmentsFromText(bookLike.rawText || '', { spineIndex: 0, href: 'text' });
    if (!hasSegments) bookLike.segments = segments;

    const pages = splitSegmentsIntoPages(segments, charsPerPage);
    attachPageIndexes(bookLike, pages, segments);
    return pages;
  }

  function splitSegmentsIntoPages(segments, charsPerPage) {
    const pages = [];
    let current = [];
    let currentChars = 0;

    const flush = () => {
      if (!current.length) return;
      const pageIndex = pages.length;
      pages.push({
        pageIndex,
        startLocId: current[0].locId,
        endLocId: current[current.length - 1].locId,
        segmentRefs: current.map(segment => segment.locId),
        text: current.map(formatSegmentText).join('\n\n')
      });
      current = [];
      currentChars = 0;
    };

    segments.forEach(segment => {
      const text = formatSegmentText(segment);
      const len = text.length + (current.length ? 2 : 0);
      if (current.length && currentChars + len > charsPerPage) {
        flush();
      }
      current.push(segment);
      currentChars += len;
    });
    flush();

    return pages;
  }

  function attachPageIndexes(bookLike, pages, segments) {
    const pageIndexByLocId = {};
    const segmentByLocId = new Map(segments.map(segment => [segment.locId, segment]));

    pages.forEach(page => {
      page.segmentRefs.forEach(locId => {
        pageIndexByLocId[locId] = page.pageIndex;
        const segment = segmentByLocId.get(locId);
        if (segment) segment.pageIndex = page.pageIndex;
      });
    });

    if (Array.isArray(bookLike.toc)) {
      bookLike.toc = bookLike.toc.map(item => ({
        ...item,
        pageIndex: item.locId && pageIndexByLocId[item.locId] !== undefined
          ? pageIndexByLocId[item.locId]
          : null
      }));
    }

    bookLike.pageIndexByLocId = pageIndexByLocId;
  }

  function splitTextIntoPages(text, charsPerPage = 2000) {
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

  function createSegmentsFromText(text, source) {
    const blocks = String(text || '')
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean);

    const segments = blocks.map((block, index) => {
      const heading = block.match(/^(#{1,6})\s+(.+)$/);
      const listItem = block.match(/^[-*]\s+(.+)$/);
      const quote = block.match(/^>\s+(.+)$/);
      const kind = heading ? 'heading' : listItem ? 'listItem' : quote ? 'blockquote' : 'paragraph';
      const level = heading ? heading[1].length : 0;
      const textValue = heading ? heading[2] : listItem ? listItem[1] : quote ? quote[1] : block;

      return {
        locId: `${source.spineIndex}:${index}`,
        spineIndex: source.spineIndex,
        href: source.href,
        elementId: null,
        anchorIds: [],
        paragraphIndexInSpine: index,
        kind,
        level,
        text: normalizeWhitespace(textValue),
        charStart: 0,
        charEnd: 0
      };
    });

    finalizeSegmentChars(segments);
    return segments;
  }

  function formatSegmentText(segment) {
    if (!segment) return '';
    switch (segment.kind) {
      case 'heading':
        return `${'#'.repeat(segment.level || 3)} ${segment.text}`;
      case 'listItem':
        return `- ${segment.text}`;
      case 'blockquote':
        return `> ${segment.text}`;
      case 'separator':
        return '---';
      default:
        return segment.text || '';
    }
  }

  function buildParsedResult(result) {
    return {
      ...result,
      parserVersion: PARSER_VERSION,
      totalChars: (result.rawText || '').length
    };
  }

  return {
    parse,
    splitIntoPages,
    formatSegmentText,
    PARSER_VERSION
  };
})();
