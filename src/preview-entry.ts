/** Static panel shell for tooling; it does not contain demo users or metrics. */
import { panelHtml } from './panel/ui';
export const html = panelHtml({ panelPath: 'panel', dbOk: false, isDefaultPassword: false, lang: 'fa' });
