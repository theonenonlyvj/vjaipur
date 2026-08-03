import type { CSSProperties } from 'react'

// Byte-identical style constants shared by StatsDashboard.tsx and
// RivalryModal.tsx — both are modals in the same "Hall of Records" visual
// language (gold #f0c030 on near-black), so their close button, section
// header, primary CTA, and MY STYLE tug-of-war track/centerline/pull-bar
// chrome happen to match exactly. `overlayStyle`/`modalStyle` are NOT here —
// they differ (zIndex, modal maxWidth) between the two files.

export const closeBtnStyle: CSSProperties = {
  background: 'none', border: 'none', color: '#888',
  fontSize: 24, cursor: 'pointer', padding: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

export const sectionHeaderStyle: CSSProperties = {
  fontSize: 11, fontWeight: 900, color: '#f0c030', letterSpacing: 1.5,
  marginBottom: 12, borderBottom: '1px solid #333', paddingBottom: 6,
}

export const closePrimaryBtnStyle: CSSProperties = {
  background: '#f0c030', color: '#000', border: 'none',
  padding: '12px 32px', borderRadius: 8, fontWeight: 900,
  cursor: 'pointer', fontSize: 14, letterSpacing: 1,
}

export const tugTrackStyle: CSSProperties = {
  position: 'relative', height: 14, background: '#221609', borderRadius: 7, overflow: 'hidden',
}

export const tugClineStyle: CSSProperties = {
  position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: '#554', zIndex: 2,
}

export const tugPullBaseStyle: CSSProperties = {
  position: 'absolute', top: 2, bottom: 2, borderRadius: 6,
}
