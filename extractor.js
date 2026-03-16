/**
 * Dusty Robotics — PDF → DXF Extractor Engine
 * Extracts vector geometry from PDF operator streams and writes DXF output.
 * Internal PoC — not for external distribution.
 */

// ─────────────────────────────────────────────
//  GEOMETRY EXTRACTION
// ─────────────────────────────────────────────

function extractGeometry(ops, viewport, options) {
  const {
    scaleFactor = 96,   // PDF units → real world (96 = 1/8"=1')
    units = 'imperial',
    rotation = 0,
    originX = 0,
    originY = 0,
    includeText = true,
    textContent = null
  } = options;

  const pageHeight = viewport.height;

  // unit conversion: PDF points → real world units
  // PDF is 72 pts/inch. Scale factor is the ratio of drawing units per inch.
  // e.g. 1/8"=1' means 1 inch on paper = 8 feet = 96 inches real.
  const ptToUnit = (pt) => {
    const inches = pt / 72;
    if (units === 'imperial') {
      return inches * (scaleFactor / 12); // result in feet
    } else {
      return inches * (scaleFactor / 12) * 304.8; // result in mm
    }
  };

  // flip Y axis (PDF origin is bottom-left, Y goes up, but PDF.js gives top-left)
  const transformX = (x) => ptToUnit(x) + originX;
  const transformY = (y) => ptToUnit(pageHeight - y) + originY; // flip

  const { fnArray, argsArray } = ops;

  const lines = [];
  const arcs = [];
  const polylines = [];
  const rectangles = [];
  const texts = [];

  let cx = 0, cy = 0;         // current point
  let pathStart = { x: 0, y: 0 };
  let currentPath = [];
  let isDrawing = false;

  // current graphics state
  const gState = { lineWidth: 0.5, r: 0, g: 0, b: 0 };
  const gStack = [];

  const OPS = pdfjsLib.OPS;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    switch (fn) {
      // graphics state
      case OPS.save:
        gStack.push({ ...gState });
        break;
      case OPS.restore:
        if (gStack.length) Object.assign(gState, gStack.pop());
        break;
      case OPS.setLineWidth:
        gState.lineWidth = args[0];
        break;
      case OPS.setStrokeRGBColor:
        gState.r = args[0]; gState.g = args[1]; gState.b = args[2];
        break;
      case OPS.setFillRGBColor:
        break; // ignore fills

      // path construction
      case OPS.moveTo: {
        const [x, y] = args;
        cx = x; cy = y;
        pathStart = { x: cx, y: cy };
        currentPath = [{ x: transformX(cx), y: transformY(cy) }];
        isDrawing = true;
        break;
      }

      case OPS.lineTo: {
        const [x, y] = args;
        if (isDrawing) {
          const x1 = transformX(cx), y1 = transformY(cy);
          const x2 = transformX(x), y2 = transformY(y);
          lines.push({ x1, y1, x2, y2, lw: gState.lineWidth });
          currentPath.push({ x: x2, y: y2 });
        }
        cx = x; cy = y;
        break;
      }

      case OPS.curveTo: {
        // cubic bezier — approximate as line segment between endpoints
        // for construction drawings, most curves are door swings/arcs
        const [x1, y1, x2, y2, x3, y3] = args;
        if (isDrawing) {
          const sx = transformX(cx), sy = transformY(cy);
          const ex = transformX(x3), ey = transformY(y3);
          // approximate arc: add midpoint for smoother representation
          const mx = transformX((cx + x3) / 2), my = transformY((cy + y3) / 2);
          lines.push({ x1: sx, y1: sy, x2: mx, y2: my, lw: gState.lineWidth });
          lines.push({ x1: mx, y1: my, x2: ex, y2: ey, lw: gState.lineWidth });
        }
        cx = x3; cy = y3;
        break;
      }

      case OPS.curveTo2: {
        const [x2, y2, x3, y3] = args;
        if (isDrawing) {
          lines.push({
            x1: transformX(cx), y1: transformY(cy),
            x2: transformX(x3), y2: transformY(y3),
            lw: gState.lineWidth
          });
        }
        cx = x3; cy = y3;
        break;
      }

      case OPS.curveTo3: {
        const [x1c, y1c, x3c, y3c] = args;
        if (isDrawing) {
          lines.push({
            x1: transformX(cx), y1: transformY(cy),
            x2: transformX(x3c), y2: transformY(y3c),
            lw: gState.lineWidth
          });
        }
        cx = x3c; cy = y3c;
        break;
      }

      case OPS.rectangle: {
        const [rx, ry, rw, rh] = args;
        const bx = transformX(rx), by = transformY(ry);
        const ex = transformX(rx + rw), ey = transformY(ry + rh);
        rectangles.push({ x: Math.min(bx, ex), y: Math.min(by, ey), w: Math.abs(ex - bx), h: Math.abs(ey - by) });
        isDrawing = false;
        break;
      }

      case OPS.closePath: {
        if (isDrawing && currentPath.length > 1) {
          const last = currentPath[currentPath.length - 1];
          const first = currentPath[0];
          if (Math.abs(last.x - first.x) > 0.001 || Math.abs(last.y - first.y) > 0.001) {
            lines.push({ x1: last.x, y1: last.y, x2: first.x, y2: first.y, lw: gState.lineWidth });
          }
        }
        if (currentPath.length > 2) {
          polylines.push([...currentPath]);
        }
        currentPath = [];
        isDrawing = false;
        break;
      }

      case OPS.endPath:
        if (currentPath.length > 2) polylines.push([...currentPath]);
        currentPath = [];
        isDrawing = false;
        break;

      case OPS.stroke:
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        if (currentPath.length > 2) polylines.push([...currentPath]);
        currentPath = [];
        isDrawing = false;
        break;
    }
  }

  // extract text entities
  if (includeText && textContent) {
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const tx = transformX(item.transform[4]);
      const ty = transformY(item.transform[5]);
      const fontSize = Math.sqrt(
        item.transform[0] * item.transform[0] +
        item.transform[1] * item.transform[1]
      );
      texts.push({
        x: tx,
        y: ty,
        text: item.str.trim(),
        height: ptToUnit(fontSize) * 0.8
      });
    }
  }

  // apply rotation if needed
  if (rotation !== 0) {
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotate = (x, y) => ({
      x: x * cos - y * sin,
      y: x * sin + y * cos
    });

    lines.forEach(l => {
      const p1 = rotate(l.x1, l.y1);
      const p2 = rotate(l.x2, l.y2);
      l.x1 = p1.x; l.y1 = p1.y;
      l.x2 = p2.x; l.y2 = p2.y;
    });

    texts.forEach(t => {
      const p = rotate(t.x, t.y);
      t.x = p.x; t.y = p.y;
    });
  }

  return {
    lines: lines.length,
    arcs: arcs.length,
    polylines: polylines.length,
    rectangles: rectangles.length,
    texts: texts.length,
    _lines: lines,
    _arcs: arcs,
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

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const unitCode = units === 'metric' ? '4' : '1'; // 1=inches, 4=mm in DXF

  const lines = [];

  // ── HEADER ──
  lines.push('0', 'SECTION');
  lines.push('2', 'HEADER');
  lines.push('9', '$ACADVER');
  lines.push('1', 'AC1015'); // AutoCAD 2000
  lines.push('9', '$INSUNITS');
  lines.push('70', unitCode);
  lines.push('9', '$MEASUREMENT');
  lines.push('70', units === 'metric' ? '1' : '0');
  lines.push('9', '$EXTMIN');
  lines.push('10', '0.0');
  lines.push('20', '0.0');
  lines.push('30', '0.0');
  lines.push('9', '$EXTMAX');
  lines.push('10', '10000.0');
  lines.push('20', '10000.0');
  lines.push('30', '0.0');
  lines.push('0', 'ENDSEC');

  // ── TABLES ──
  lines.push('0', 'SECTION');
  lines.push('2', 'TABLES');

  // LAYER table
  lines.push('0', 'TABLE');
  lines.push('2', 'LAYER');
  lines.push('70', '4');

  // geometry layer
  lines.push('0', 'LAYER');
  lines.push('2', 'DUSTY-GEOMETRY');
  lines.push('70', '0');
  lines.push('62', '7'); // white
  lines.push('6', 'Continuous');

  // text layer
  lines.push('0', 'LAYER');
  lines.push('2', 'DUSTY-TEXT');
  lines.push('70', '0');
  lines.push('62', '3'); // green
  lines.push('6', 'Continuous');

  // info layer
  lines.push('0', 'LAYER');
  lines.push('2', 'DUSTY-INFO');
  lines.push('70', '0');
  lines.push('62', '1'); // red
  lines.push('6', 'Continuous');

  lines.push('0', 'ENDTAB');
  lines.push('0', 'ENDSEC');

  // ── ENTITIES ──
  lines.push('0', 'SECTION');
  lines.push('2', 'ENTITIES');

  // header comment block as TEXT entities
  const headerLines = [
    `DUSTY ROBOTICS - PDF TO DXF EXTRACTION`,
    `Source: ${outputName}`,
    `Extracted: ${dateStr}`,
    `Trade: ${trade} | Type: ${drawingType}`,
    `Scale Factor: 1/${scaleFactor} | Units: ${units}`,
    fitPage ? `WARNING: FIT-TO-PAGE - SCALE MAY NOT BE ACCURATE` : `Scale: confirmed at drawing settings`,
    rotation !== 0 ? `Rotation applied: ${rotation} degrees` : `No rotation applied`,
    originX !== 0 || originY !== 0 ? `Origin offset: ${originX}, ${originY}` : `Origin: 0,0`,
    `Lines: ${result.lines} | Arcs: ${result.arcs} | Polylines: ${result.polylines} | Text: ${result.texts}`,
    `IMPORTANT: Convert to DWG before uploading to Dusty Portal`
  ];

  let infoY = -2;
  for (const hl of headerLines) {
    lines.push('0', 'TEXT');
    lines.push('8', 'DUSTY-INFO');
    lines.push('10', '-50');
    lines.push('20', String(infoY));
    lines.push('30', '0.0');
    lines.push('40', '0.5');
    lines.push('1', hl);
    infoY -= 1;
  }

  // LINE entities
  for (const l of result._lines) {
    if (!isFinite(l.x1) || !isFinite(l.y1) || !isFinite(l.x2) || !isFinite(l.y2)) continue;
    lines.push('0', 'LINE');
    lines.push('8', 'DUSTY-GEOMETRY');
    lines.push('10', fmt(l.x1));
    lines.push('20', fmt(l.y1));
    lines.push('30', '0.0');
    lines.push('11', fmt(l.x2));
    lines.push('21', fmt(l.y2));
    lines.push('31', '0.0');
  }

  // RECTANGLE → 4 LINEs
  for (const r of result._rectangles) {
    if (!isFinite(r.x) || !isFinite(r.y)) continue;
    const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    const corners = [[x1,y1,x2,y1],[x2,y1,x2,y2],[x2,y2,x1,y2],[x1,y2,x1,y1]];
    for (const [ax,ay,bx,by] of corners) {
      lines.push('0', 'LINE');
      lines.push('8', 'DUSTY-GEOMETRY');
      lines.push('10', fmt(ax)); lines.push('20', fmt(ay)); lines.push('30', '0.0');
      lines.push('11', fmt(bx)); lines.push('21', fmt(by)); lines.push('31', '0.0');
    }
  }

  // POLYLINE → LWPOLYLINE
  for (const poly of result._polylines) {
    if (poly.length < 2) continue;
    const validPts = poly.filter(p => isFinite(p.x) && isFinite(p.y));
    if (validPts.length < 2) continue;
    lines.push('0', 'LWPOLYLINE');
    lines.push('8', 'DUSTY-GEOMETRY');
    lines.push('90', String(validPts.length));
    lines.push('70', '0'); // open
    for (const pt of validPts) {
      lines.push('10', fmt(pt.x));
      lines.push('20', fmt(pt.y));
    }
  }

  // TEXT entities
  for (const t of result._texts) {
    if (!isFinite(t.x) || !isFinite(t.y)) continue;
    if (!t.text || !t.text.trim()) continue;
    lines.push('0', 'TEXT');
    lines.push('8', 'DUSTY-TEXT');
    lines.push('10', fmt(t.x));
    lines.push('20', fmt(t.y));
    lines.push('30', '0.0');
    lines.push('40', fmt(Math.max(t.height, 0.05)));
    lines.push('1', t.text.replace(/[^\x20-\x7E]/g, '?')); // ASCII only
  }

  lines.push('0', 'ENDSEC');
  lines.push('0', 'EOF');

  return lines.join('\n');
}

// format a number for DXF — 6 decimal places, trim trailing zeros
function fmt(n) {
  if (!isFinite(n)) return '0.0';
  return parseFloat(n.toFixed(6)).toString();
}
