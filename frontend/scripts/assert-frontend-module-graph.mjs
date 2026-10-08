export function assertFrontendModuleGraph(app) {
  const expected = app === 'public' ? '/apps/public/src/' : '/apps/admin/src/';
  const forbidden = app === 'public'
    ? ['/apps/admin/src/']
    : ['/apps/public/src/', '/node_modules/leaflet/', '/node_modules/leaflet.markercluster/', '/node_modules/react-leaflet/'];

  return {
    name: `assert-${app}-frontend-module-graph`,
    generateBundle() {
      const modules = [...this.getModuleIds()].map((id) => id.replaceAll('\\', '/'));
      const unexpected = modules.filter((id) => forbidden.some((fragment) => id.includes(fragment)));
      const appModules = modules.filter((id) => id.includes(expected));
      if (appModules.length === 0) this.error(`${app} build did not contain its own application source graph`);
      if (unexpected.length > 0) this.error(`${app} build crossed its application boundary:\n${unexpected.join('\n')}`);
      console.info(`[${app} build graph] ${modules.length} modules; ${appModules.length} app-owned modules; forbidden graph absent`);
    },
  };
}
