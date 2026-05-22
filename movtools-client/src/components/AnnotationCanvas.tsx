import { useEffect, useRef, useState, useCallback } from 'react';

export type DrawTool = 'pen' | 'arrow' | 'rect' | 'circle' | 'text';

export interface AnnotationPath {
  id: string;
  tool: DrawTool;
  color: string;
  lineWidth: number;
  points: Array<{ x: number; y: number }>;
  text?: string;
}

interface AnnotationCanvasProps {
  width: number;
  height: number;
  enabled: boolean;
  paths: AnnotationPath[];
  onPathsChange: (paths: AnnotationPath[]) => void;
  currentFrameNumber: number;
  onClearFrame?: (frameNumber: number) => void;
  onUndo?: () => void;
}

let pathIdCounter = 0;
function nextPathId(): string {
  pathIdCounter += 1;
  return `path_${Date.now()}_${pathIdCounter}`;
}

const DEFAULT_COLOR = '#ff4444';
const DEFAULT_LINE_WIDTH = 3;

export function AnnotationCanvas({
  width,
  height,
  enabled,
  paths,
  onPathsChange,
  currentFrameNumber,
  onClearFrame,
  onUndo,
}: AnnotationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentTool, setCurrentTool] = useState<DrawTool>('pen');
  const [currentColor, setCurrentColor] = useState(DEFAULT_COLOR);
  const [currentLineWidth, setCurrentLineWidth] = useState(DEFAULT_LINE_WIDTH);
  const drawingRef = useRef(false);
  const currentPathRef = useRef<AnnotationPath | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const path of paths) {
      if (path.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      ctx.stroke();
    }

    if (currentPathRef.current && currentPathRef.current.points.length >= 2) {
      const p = currentPathRef.current;
      ctx.beginPath();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(p.points[0].x, p.points[0].y);
      for (let i = 1; i < p.points.length; i++) {
        ctx.lineTo(p.points[i].x, p.points[i].y);
      }
      ctx.stroke();
    }
  }, [paths]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  function getPos(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!enabled) return;
    drawingRef.current = true;
    const pos = getPos(e);
    currentPathRef.current = {
      id: nextPathId(),
      tool: currentTool,
      color: currentColor,
      lineWidth: currentLineWidth,
      points: [pos],
    };
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !currentPathRef.current) return;
    const pos = getPos(e);
    currentPathRef.current = {
      ...currentPathRef.current,
      points: [...currentPathRef.current.points, pos],
    };
    redraw();
  }

  function handleMouseUp() {
    if (!drawingRef.current || !currentPathRef.current) {
      drawingRef.current = false;
      return;
    }
    drawingRef.current = false;
    if (currentPathRef.current.points.length >= 2) {
      onPathsChange([...paths, currentPathRef.current]);
    }
    currentPathRef.current = null;
  }

  function handleClear() {
    if (!window.confirm('确认清空所有标注？')) return;
    onPathsChange([]);
    onClearFrame?.(currentFrameNumber);
    currentPathRef.current = null;
    redraw();
  }

  function handleUndo() {
    if (onUndo) {
      onUndo();
      return;
    }
    if (paths.length === 0) return;
    onPathsChange(paths.slice(0, -1));
  }

  const TOOLS: DrawTool[] = ['pen', 'arrow', 'rect', 'circle'];
  const COLORS = ['#ff4444', '#ffaa00', '#44ff44', '#4488ff', '#ffffff'];

  return (
    <div className="annotation-canvas-wrapper">
      {enabled && (
        <div className="annotation-toolbar">
          <div className="annotation-tool-group">
            {TOOLS.map((tool) => (
              <button
                key={tool}
                className={`annotation-tool-btn ${currentTool === tool ? 'active' : ''}`}
                onClick={() => setCurrentTool(tool)}
                title={tool === 'pen' ? '画笔' : tool === 'arrow' ? '箭头' : tool === 'rect' ? '矩形' : '圆形'}
                type="button"
              >
                {tool === 'pen' ? '✏' : tool === 'arrow' ? '→' : tool === 'rect' ? '▭' : '○'}
              </button>
            ))}
          </div>
          <div className="annotation-tool-group">
            {COLORS.map((color) => (
              <button
                key={color}
                className={`annotation-color-btn ${currentColor === color ? 'active' : ''}`}
                onClick={() => setCurrentColor(color)}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
          </div>
          <div className="annotation-tool-group">
            {[2, 4, 6].map((w) => (
              <button
                key={w}
                className={`annotation-width-btn ${currentLineWidth === w ? 'active' : ''}`}
                onClick={() => setCurrentLineWidth(w)}
                type="button"
              >
                {w}px
              </button>
            ))}
          </div>
          <div className="annotation-tool-group">
            <button className="annotation-action-btn" onClick={handleUndo} type="button" disabled={paths.length === 0}>
              撤销
            </button>
            <button className="annotation-action-btn" onClick={handleClear} type="button" disabled={paths.length === 0}>
              清屏
            </button>
          </div>
        </div>
      )}
      <div className="annotation-canvas-container" style={{ width: '100%', height: '100%' }}>
        <canvas
          ref={canvasRef}
          className={`annotation-canvas ${enabled ? 'annotation-canvas--enabled' : ''}`}
          height={height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ width: '100%', height: '100%' }}
          width={width}
        />
      </div>
    </div>
  );
}

export function serializeAnnotationPaths(paths: AnnotationPath[]): string {
  return JSON.stringify(paths);
}

export function deserializeAnnotationPaths(json?: string | null): AnnotationPath[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as AnnotationPath[];
  } catch {
    return [];
  }
}

export function pathsToDataUrl(
  paths: AnnotationPath[],
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  for (const path of paths) {
    if (path.points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = path.color;
    ctx.lineWidth = path.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.stroke();
  }

  return canvas.toDataURL('image/png');
}
