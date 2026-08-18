'use client'

// Chassis — the PSY family hardware synth wrapper.
//
// Wraps the entire app in a brushed-metal chassis with wood side cheeks
// and corner screws, matching PsySynthPro exactly. This is the signature
// PSY hardware aesthetic — every family member uses the same chassis.
//
// The CSS is in psy-design.css (copied verbatim from PsySynthPro).

import * as React from 'react'

export function Chassis({ children }: { children: React.ReactNode }) {
  return (
    <div className="chassis">
      {/* Wood side cheeks — hidden on screens ≤1280px */}
      <div className="cheek l" aria-hidden="true" />
      <div className="cheek r" aria-hidden="true" />
      {/* Corner screws — each rotated differently for realism */}
      <div className="screw tl" style={{ ['--r' as string]: '18deg' }} aria-hidden="true" />
      <div className="screw tr" style={{ ['--r' as string]: '66deg' }} aria-hidden="true" />
      <div className="screw bl" style={{ ['--r' as string]: '-32deg' }} aria-hidden="true" />
      <div className="screw br" style={{ ['--r' as string]: '81deg' }} aria-hidden="true" />
      {children}
      {/* Brand footer */}
      <div className="brand">
        PSY SAMPLER
        <span>canonical realization device · build 2026</span>
      </div>
    </div>
  )
}
