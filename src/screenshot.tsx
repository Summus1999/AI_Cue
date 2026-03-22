import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenshotSelector } from './components/ScreenshotSelector';
import './index.css';
import { perfScreenshotWindowCreated, perfScreenshotImageReady, perfScreenshotInteractive } from './services/perf/perfInstrumentation';

const params = new URLSearchParams(window.location.search);
const transportType = (params.get('transportType') || 'disk') as 'memory' | 'disk';
const payloadRef = params.get('payloadRef') || '';
const logicalWidth = Number(params.get('logicalWidth') || '0');
const logicalHeight = Number(params.get('logicalHeight') || '0');
const physicalWidth = Number(params.get('physicalWidth') || '0');
const physicalHeight = Number(params.get('physicalHeight') || '0');

// 记录截图窗口已创建
perfScreenshotWindowCreated({ logicalWidth, logicalHeight, physicalWidth, physicalHeight, transportType });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ScreenshotSelector
      transportType={transportType}
      payloadRef={payloadRef}
      logicalWidth={logicalWidth}
      logicalHeight={logicalHeight}
      physicalWidth={physicalWidth}
      physicalHeight={physicalHeight}
      onImageReady={() => perfScreenshotImageReady({ transportType })}
      onInteractive={() => perfScreenshotInteractive()}
    />
  </StrictMode>,
);
