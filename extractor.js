/**
 * Dusty Robotics — PDF → DXF Extractor Engine v3
 * Clean build — direct operator number comparisons.
 */

function extractGeometry(ops, viewport, options) {
  const {
    scaleFactor = 96,
    units = 'imperial',
    rotation = 0,
    originX = 0,
    originY = 0,
    includeText = true,
    textContent = null
  } = options;

  const pageHeight = viewport.height;

  const ptToUnit = (pt) => {
    const inches = pt / 72;
    return units === 'imperial'
      ? inches * (scaleFactor / 12)
      : inches * (scaleFactor / 12) * 304.8;
  };

  const transformX = (x) => ptToUnit(x) + originX;
  const transformY = (y) => ptToUnit(pageHeight - y) + originY;

  const { fnArray, argsArray } = ops;

  const lines = [];
  const polylines = [];
  const rectangles = [];
  const texts = [];

  let cx = 0, cy = 0;
  let currentPath = [];
  let isDrawing = false;
  const opsSeen = {};

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    opsSeen[fn] = (opsSeen[fn] || 0) + 1;

    // moveTo (op 10)
    if (fn === 10 && args && args.length >= 2) {
      cx = args[0]; cy = args[1];
      currentPath = [{ x: transformX(cx), y: transformY(cy) }];
      isDrawing = true;
    }

    // lineTo (op 11)
    else if (fn === 11 && args && args.length >= 2) {
      const px = transformX(args[0]);
      const py = transformY(args[1]);
      if (isDrawing && currentPath.length > 0) {
        const prev = currentPath[currentPath.length - 1];
        lines.push({ x1: prev.x, y1: prev.y, x2: px, y2: py });
      }
      currentPath.push({ x: px, y: py });
      cx = args[0]; cy = args[1];
      isDrawing = true;
    }

    // curveTo (op 12) — cubic bezier, approximate with 4 segments
    else if (fn === 12 && args && args.length >= 6 && isDrawing) {
      const bx0 = cx, by0 = cy;
      const bx1 = args[0], by1 = args[1];
      const bx2 = args[2], by2 = args[3];
      const bx3 = args[4], by3 = args[5];
      let prevPt = currentPath[currentPath.length - 1] || { x: transformX(bx0), y: transformY(by0) };
      for (let t = 0.25; t <= 1.001; t += 0.25) {
        const mt = 1 - t;
        const nx = mt*mt*mt*bx0 + 3*mt*mt*t*bx1 + 3*mt*t*t*bx2 + t*t*t*bx3;
        const ny = mt*mt*mt*by0 + 3*mt*mt*t*by1 + 3*mt*t*t*by2 + t*t*t*by3;
        const np = { x: transformX(nx), y: transformY(ny) };
        lines.push({ x1: prevPt.x, y1: prevPt.y, x2: np.x, y2: np.y });
        currentPath.push(np);
        prevPt = np;
      }
      cx = bx3; cy = by3;
    }

    // rectangle (op 91)
    else if (fn === 91 && args && args.length >= 4) {
      const rx = args[0], ry = args[1], rw = args[2], rh = args[3];
      const x1 = transformX(rx), y1 = transformY(ry);
      const x2 = transformX(rx + rw), y2 = transformY(ry + rh);
      rectangles.push({ x1, y1, x2, y2 });
      lines.push({ x1, y1, x2, y2: y1 });
      lines.push({ x1: x2, y1, x2, y2 });
      lines.push({ x1: x2, y1: y2, x2: x1, y2 });
      lines.push({ x1, y1: y2, x2: x1, y2: y1 });
      isDrawing = false;
      currentPath = [];
    }

    // closePath (op 9)
    else if (fn === 9) {
      if (isDrawing && currentPath.length > 1) {
        const last = currentPath[currentPath.length - 1];
        const first = currentPath[0];
        if (Math.abs(last.x - first.x) > 0.0001 || Math.abs(last.y - first.y) > 0.0001) {
          lines.push({ x1: last.x, y1: last.y, x2: first.x, y2: first.y });
        }
      }
      if (currentPath.length > 2) polylines.push([...currentPath]);
      currentPath = [];
      isDrawing = false;
    }

    // stroke / fill / endPath — finalize path (ops 20,21,22,23,24,25,26,27,28)
    else if (fn >= 20 && fn <= 28) {
      if (currentPath.length > 2) polylines.push([...currentPath]);
      currentPath = [];
      isDrawing = false;
    }
  }

  console.log('[Dusty Extractor] Operators:', Object.keys(opsSeen).sort((a,b)=>Number(a)-Number(b)).map(k=>`${k}:${opsSeen[k]}`).join(', '));
  console.log('[Dusty Extractor] Lines:', lines.length, '| Rects:', rectangles.length, '| Polylines:', polylines.length);

  // text entities
  if (includeText && textContent) {
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const fontSize = Math.abs(item.transform[0]) || Math.abs(item.transform[3]) || 10;
      texts.push({
        x: transformX(item.transform[4]),
        y: transformY(item.transform[5]),
        text: item.str.trim(),
        height: ptToUnit(fontSize) * 0.7
      });
    }
  }

  // rotation
  if (rotation !== 0) {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotate = (x, y) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    lines.forEach(l => {
      const p1 = rotate(l.x1, l.y1); const p2 = rotate(l.x2, l.y2);
      l.x1 = p1.x; l.y1 = p1.y; l.x2 = p2.x; l.y2 = p2.y;
    });
    texts.forEach(t => { const p = rotate(t.x, t.y); t.x = p.x; t.y = p.y; });
  }

  return {
    lines: lines.length,
    arcs: 0,
    polylines: polylines.length,
    rectangles: rectangles.length,
    texts: texts.length,
    _lines: lines,
    _arcs: [],
    _polylines: polylines,
    _rectangles: rectangles,
    _texts: texts
  };
}


// ─────────────────────────────────────────────
//  DXF WRITER
// ─────────────────────────────────────────────

function buildDXF(result, options) {
  const {
    trade = 'General',
    drawingType = 'floor',
    scaleFactor = 96,
    units = 'imperial',
    outputName = 'dusty-extract',
    fitPage = false,
    rotation = 0,
    originX = 0,
    originY = 0
  } = options;

  const dateStr = new Date().toISOString().split('T')[0];
  const unitCode = units === 'metric' ? '4' : '1';
  const out = [];

  // HEADER
  out.push('0\nSECTION\n2\nHEADER');
  out.push('9\n$ACADVER\n1\nAC1015');
  out.push('9\n$INSUNITS\n70\n' + unitCode);
  out.push('9\n$MEASUREMENT\n70\n' + (units === 'metric' ? '1' : '0'));
  out.push('0\nENDSEC');

  // TABLES
  out.push('0\nSECTION\n2\nTABLES');
  out.push('0\nTABLE\n2\nLAYER\n70\n3');
  out.push('0\nLAYER\n2\nDUSTY-GEOMETRY\n70\n0\n62\n7\n6\nContinuous');
  out.push('0\nLAYER\n2\nDUSTY-TEXT\n70\n0\n62\n3\n6\nContinuous');
  out.push('0\nLAYER\n2\nDUSTY-INFO\n70\n0\n62\n1\n6\nContinuous');
  out.push('0\nENDTAB\n0\nENDSEC');

  // ENTITIES
  out.push('0\nSECTION\n2\nENTITIES');

  // info text block
  const infoLines = [
    'DUSTY ROBOTICS - PDF TO DXF EXTRACTION',
    `Source: ${outputName} | Date: ${dateStr}`,
    `Trade: ${trade} | Type: ${drawingType}`,
    `Scale: 1/${scaleFactor} | Units: ${units}`,
    fitPage ? 'WARNING: FIT-TO-PAGE - SCALE MAY NOT BE ACCURATE' : 'Scale: as specified',
    `Lines: ${result.lines} | Polylines: ${result.polylines} | Text: ${result.texts}`,
    'Convert to DWG before uploading to Dusty Portal'
  ];
  let iy = -2;
  for (const t of infoLines) {
    out.push(`0\nTEXT\n8\nDUSTY-INFO\n10\n-50\n20\n${iy}\n30\n0\n40\n0.5\n1\n${t}`);
    iy -= 1;
  }

  // LINE entities
  for (const l of result._lines) {
    if (!isFinite(l.x1) || !isFinite(l.y1) || !isFinite(l.x2) || !isFinite(l.y2)) continue;
    if (Math.abs(l.x1 - l.x2) < 0.0001 && Math.abs(l.y1 - l.y2) < 0.0001) continue;
    out.push(`0\nLINE\n8\nDUSTY-GEOMETRY\n10\n${fmt(l.x1)}\n20\n${fmt(l.y1)}\n30\n0\n11\n${fmt(l.x2)}\n21\n${fmt(l.y2)}\n31\n0`);
  }

  // LWPOLYLINE entities
  for (const poly of result._polylines) {
    const valid = poly.filter(p => isFinite(p.x) && isFinite(p.y));
    if (valid.length < 2) continue;
    let pline = `0\nLWPOLYLINE\n8\nDUSTY-GEOMETRY\n90\n${valid.length}\n70\n0`;
    for (const pt of valid) pline += `\n10\n${fmt(pt.x)}\n20\n${fmt(pt.y)}`;
    out.push(pline);
  }

  // TEXT entities
  for (const t of result._texts) {
    if (!isFinite(t.x) || !isFinite(t.y) || !t.text.trim()) continue;
    const safe = t.text.replace(/[^\x20-\x7E]/g, '?').replace(/\n/g, ' ');
    out.push(`0\nTEXT\n8\nDUSTY-TEXT\n10\n${fmt(t.x)}\n20\n${fmt(t.y)}\n30\n0\n40\n${fmt(Math.max(t.height, 0.05))}\n1\n${safe}`);
  }

  out.push('0\nENDSEC\n0\nEOF');
  return out.join('\n');
}

function fmt(n) {
  if (!isFinite(n)) return '0';
  return parseFloat(n.toFixed(4)).toString();
}
