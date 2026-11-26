// Client half of dsh-mys-checkin: a sidebar row that opens the check-in panel.
// The panel itself is the plugin's server-rendered page at /mys-checkin, so this
// file only has to put a frame around it.
window.__ModuleLoader__.load({
  id: 'dsh-mys-checkin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'mys-checkin'

    function Panel() {
      return h('iframe', {
        src: '/mys-checkin',
        title: '米游社每日签到',
        style: {
          display: 'block',
          width: '100%',
          height: '100%',
          minHeight: '620px',
          border: '0',
          background: 'transparent',
        },
      })
    }

    function SidebarIcon(owner) {
      const size = (owner && owner.size) || 16
      return h('span', {
        'aria-hidden': true,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: 4,
          overflow: 'hidden',
          background: '#eaf6ff',
        },
      }, h('img', {
        src: '/mys-checkin/assets/miyoushe.png',
        alt: '',
        width: size,
        height: size,
        style: { display: 'block', objectFit: 'contain' },
      }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Panel))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 2,
          label: () => '米游社签到',
        }, SidebarIcon))
      },
    }
  },
})
