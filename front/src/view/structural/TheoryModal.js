import React, { useState } from 'react';
import { useT } from '../../i18n/LanguageContext';

function Formula({ children }) {
  return (
    <div className="bg-[#0d1220] border border-[#1b2a40] rounded-lg px-3 py-2 my-2
                    font-mono text-[11px] text-emerald-300 whitespace-pre leading-relaxed">
      {children}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-bold text-blue-400 mb-1.5 tracking-wide">{title}</p>
      <div className="text-[11px] text-gray-300 leading-relaxed">{children}</div>
    </div>
  );
}

function VarRow({ sym, desc, value, unit }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="font-mono text-amber-300 w-20 shrink-0">{sym}</span>
      <span className="text-gray-400 flex-1">{desc}</span>
      {value != null && (
        <span className="font-mono text-blue-300 shrink-0">{value} {unit ?? ''}</span>
      )}
    </div>
  );
}

function TabMethod() {
  const t = useT('bimDashboard');
  return (
    <>
      <Section title={t('tmDsmTitle')}>
        {t('tmDsmDesc')}
      </Section>

      <Section title={t('tmKeyEqTitle')}>
        <Formula>{`[K] · {U} = {F}

K  Global stiffness matrix
U  Nodal displacement vector
F  External force vector`}</Formula>
        {t('tmKeyEqDesc')}
      </Section>

      <Section title={t('tm3dSetupTitle')}>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div className="bg-[#0f1422] border border-[#1b2236] rounded-xl p-2.5">
            <p className="text-blue-400 font-bold mb-1">{t('tmNodeTitle')}</p>
            <p className="text-gray-500">{t('tmNodeDesc')}</p>
          </div>
          <div className="bg-[#0f1422] border border-[#1b2236] rounded-xl p-2.5">
            <p className="text-blue-400 font-bold mb-1">{t('tmElemTitle')}</p>
            <p className="text-gray-500">{t('tmElemDesc')}</p>
          </div>
          <div className="bg-[#0f1422] border border-[#1b2236] rounded-xl p-2.5">
            <p className="text-blue-400 font-bold mb-1">{t('tmDofTitle')}</p>
            <p className="text-gray-500">{t('tmDofDesc')}</p>
          </div>
          <div className="bg-[#0f1422] border border-[#1b2236] rounded-xl p-2.5">
            <p className="text-blue-400 font-bold mb-1">{t('tmBcTitle')}</p>
            <p className="text-gray-500">{t('tmBcDesc')}</p>
          </div>
        </div>
      </Section>

      <Section title={t('tmFlowTitle')}>
        <div className="flex flex-col gap-1">
          {[
            [t('tmStepBimParse'), t('tmStep1')],
            [t('tmStepStiff'),    t('tmStep2')],
            [t('tmStepLoad'),     t('tmStep3')],
            [t('tmStepSolve'),    t('tmStep4')],
            [t('tmStepMember'),   t('tmStep5')],
            [t('tmStepSafety'),   t('tmStep6')],
          ].map(([step, desc]) => (
            <div key={step} className="flex gap-2">
              <span className="text-blue-400 font-mono shrink-0 w-20">{step}</span>
              <span className="text-gray-400">{desc}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function TabLoads({ codeStandard, structureType, appliedLoads }) {
  const t = useT('bimDashboard');
  const isKDS  = codeStandard === 'KDS';
  const isBrdg = structureType === 'BRIDGE';

  return (
    <>
      <Section title={t('tmDeadTitle')}>
        <Formula>{`W_self = γ × b × h × L

γ    unit weight  [concrete 24 kN/m³ / steel 78.5 kN/m³]
b×h  cross-section area (m²)
L    member length (m)`}</Formula>
        {appliedLoads?.deadLoad != null && (
          <p className="text-blue-300 mt-1">{t('tmCurrentVal')} <span className="font-mono">{appliedLoads.deadLoad.toFixed(1)} kN</span></p>
        )}
      </Section>

      <Section title={t('tmLiveTitle')}>
        <Formula>{isKDS
          ? `q_L  [kN/m²]  ×  floor area [m²]\n\nOffice 2.5 / Residential 2.0 / Parking 5.0 kN/m²`
          : `q_k  [kN/m²]  ×  floor area [m²]\n\nCategory B(office) 3.0 / A(residential) 2.0 kN/m²`
        }</Formula>
        {appliedLoads?.liveLoad != null && (
          <p className="text-blue-300 mt-1">{t('tmCurrentVal')} <span className="font-mono">{appliedLoads.liveLoad.toFixed(1)} kN</span></p>
        )}
      </Section>

      <Section title={isBrdg ? t('tmTrafficTitle') : t('tmWindTitle2')}>
        {!isBrdg && (
          <Formula>{isKDS
            ? `q_w = 0.6125 × V₀² / 1000 × Kd × Kzt × Cf × G\n\nV₀ = 30 m/s, design wind pressure (kN/m²)`
            : `q_p = Ce × 0.5 × ρ × vb²\nFw  = q_p × Cf × exposed area\n\nvb = 28 m/s`
          }</Formula>
        )}
        {isBrdg && (
          <Formula>{isKDS
            ? `DB-24: P_truck = 240 kN, w_lane = 12.7 kN/m`
            : `LM1:   Q_1k = 300 kN (tandem), q_1k = 9 kN/m²`
          }</Formula>
        )}
        {appliedLoads?.windLoad != null && (
          <p className="text-blue-300 mt-1">{t('tmCurrentVal')} <span className="font-mono">{appliedLoads.windLoad.toFixed(1)} kN</span></p>
        )}
      </Section>

      <Section title={t('tmSeismicTitle2')}>
        <Formula>{isKDS
          ? `V = Cs × W\nCs = SDS / (R / Ie)\n\nSDS: design spectral acceleration, R: response modification, Ie: importance`
          : `Fb = Sd(T₁) × m × λ\nSd = ag × S × 2.5 / q\n\nag: design acceleration, S: soil factor, q: behavior factor`
        }</Formula>
        {appliedLoads?.seismicForce != null && (
          <p className="text-blue-300 mt-1">{t('tmCurrentVal')} <span className="font-mono">{appliedLoads.seismicForce.toFixed(1)} kN</span></p>
        )}
      </Section>

      <Section title={t('tmComboTitle')}>
        <Formula>{isKDS
          ? `① 1.4D\n② 1.2D + 1.6L          ← governing for most buildings\n③ 1.2D + 1.0W + L\n④ 1.2D + 1.0E + L\n⑤ 0.9D + 1.0W`
          : `① 1.35G_k + 1.5Q_k\n② 1.35G_k + 1.5Q_k + 0.9W_k\n③ 1.0G_k + 1.0Q_k + 1.0A_Ed`
        }</Formula>
        {appliedLoads?.governingCombo != null && (
          <p className="text-amber-300 mt-1 font-semibold">{t('tmGovCombo')} <span className="font-mono">#{appliedLoads.governingCombo}</span></p>
        )}
      </Section>
    </>
  );
}

function TabStress() {
  const t = useT('bimDashboard');
  return (
    <>
      <Section title={t('tmMemberForceTitle')}>
        {t('tmMemberForceDesc')}
        <Formula>{`{f_local} = [ke] · [T] · {u_global}

N   axial force  (kN)  +tension / −compression
Vy  shear y      (kN)
Vz  shear z      (kN)
Tx  torsion      (kN·m)
My  moment y     (kN·m)  strong-axis bending
Mz  moment z     (kN·m)  weak-axis bending`}</Formula>
      </Section>

      <Section title={t('tmStressCalcTitle')}>
        <Formula>{`σ_axial   = N / A / 1000                [MPa]
σ_bending = M_max × c / I / 1000      [MPa]
τ_shear   = 1.5 × V_res / A / 1000   [MPa]
τ_torsion ≈ Tx × c / (2·Iy·Iz/(Iy+Iz)) / 1000 [MPa]

V_res = √(Vy² + Vz²)
σ_total = |σ_axial| + σ_bend_y + σ_bend_z`}</Formula>
        <div className="mt-2 text-gray-500">
          {t('tmUnitNote')}
        </div>
      </Section>

      <Section title={t('tmSectionPropTitle')}>
        <div className="flex flex-col gap-0.5">
          <VarRow sym="A = b×h"      desc={t('tmVarA')} />
          <VarRow sym="Iz = b·h³/12" desc={t('tmVarIz')} />
          <VarRow sym="Iy = h·b³/12" desc={t('tmVarIy')} />
          <VarRow sym="J"            desc={t('tmVarJ')} />
          <VarRow sym="c = h/2"      desc={t('tmVarC')} />
          <VarRow sym="G = E/2(1+ν)" desc={t('tmVarG')} />
        </div>
      </Section>

      <Section title={t('tmLocalCoordTitle')}>
        {t('tmLocalCoordDesc')}
        <div className="mt-1 flex flex-col gap-0.5">
          <VarRow sym="local-x" desc={t('tmLocalX')} />
          <VarRow sym="local-y" desc={t('tmLocalY')} />
          <VarRow sym="local-z" desc={t('tmLocalZ')} />
        </div>
        <p className="text-gray-500 mt-1">
          {t('tmLocalCoordNote')}
        </p>
      </Section>
    </>
  );
}

function TabSafety({ codeStandard }) {
  const t = useT('bimDashboard');
  const isKDS = codeStandard === 'KDS';
  return (
    <>
      {isKDS ? (
        <>
          <Section title={t('tmKdsTitle')}>
            {t('tmKdsDesc')}
            <Formula>{`SF = f_allow / σ_total

f_allow (concrete) = f_ck / SF_safe  e.g. 24 / 2.0 = 12 MPa
f_allow (steel)    = f_y  / SF_safe  e.g. 235 / 2.0 = 117.5 MPa`}</Formula>
            <div className="mt-1 flex flex-col gap-1">
              <VarRow sym="SF ≥ 2.0"       desc={t('tmKdsSafe')} />
              <VarRow sym="1.0 ≤ SF < 2.0" desc={t('tmKdsWarn')} />
              <VarRow sym="SF < 1.0"        desc={t('tmKdsDanger')} />
            </div>
          </Section>
          <Section title={t('tmKdsComboTitle')}>
            <Formula>{`ratio = (σ_total / f_allow) + (τ_total / f_allow_v)

SF = 1 / ratio

f_allow_v (concrete) ≈ 0.4 × √f_ck  ≈ 2.0 MPa
f_allow_v (steel)    = f_y / (√3 × SF_safe)`}</Formula>
          </Section>
        </>
      ) : (
        <>
          <Section title={t('tmEc2Title')}>
            {t('tmEc2Desc')}
            <Formula>{`U = σ_Ed / σ_Rd  (utilization ratio)

σ_Rd (concrete) = f_ck / γ_c   e.g. 24 / 1.5 = 16 MPa
σ_Rd (steel)    = f_y  / γ_M0  e.g. 235 / 1.0 = 235 MPa`}</Formula>
            <div className="mt-1 flex flex-col gap-1">
              <VarRow sym="U ≤ 0.70"       desc={t('tmEc2Safe')} />
              <VarRow sym="0.70 < U ≤ 1.0" desc={t('tmEc2Warn')} />
              <VarRow sym="U > 1.0"         desc={t('tmEc2Danger')} />
            </div>
          </Section>
          <Section title={t('tmGammaTitle')}>
            <div className="flex flex-col gap-0.5">
              <VarRow sym="γ_c = 1.5"  desc={t('tmGammaCDesc')} />
              <VarRow sym="γ_M0 = 1.0" desc={t('tmGammaM0Desc')} />
              <VarRow sym="γ_M1 = 1.0" desc={t('tmGammaM1Desc')} />
            </div>
          </Section>
        </>
      )}

      <Section title={t('tmVizTitle')}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-green-500 shrink-0" />
            <span>{t('tmVizSafe')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-amber-500 shrink-0" />
            <span>{t('tmVizWarn')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-red-500 shrink-0" />
            <span>{t('tmVizDanger')}</span>
          </div>
        </div>
        <p className="text-gray-500 mt-2">
          {t('tmVizNote')}
        </p>
      </Section>
    </>
  );
}

export default function TheoryModal({ open, onClose, codeStandard = 'KDS', structureType = 'BUILDING', appliedLoads }) {
  const t = useT('bimDashboard');
  const [tab, setTab] = useState('method');

  const TABS = [
    { id: 'method', label: t('tmTabMethod') },
    { id: 'loads',  label: t('tmTabLoads') },
    { id: 'stress', label: t('tmTabStress') },
    { id: 'safety', label: t('tmTabSafety') },
  ];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-[#080c18] border border-[#1e2d48] rounded-2xl shadow-2xl flex flex-col"
        style={{ width: 'min(680px, 96vw)', maxHeight: '88vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#141a2a] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-gray-100">📐 {t('tmTitle')}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-600/30">
              {codeStandard === 'EUROCODE2' ? 'EC2' : codeStandard} · {structureType === 'BRIDGE' ? t('tmBadgeBridge') : t('tmBadgeBuilding')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-[#0f1422] border border-[#141a2a] text-gray-500
                       hover:text-gray-200 hover:bg-[#1b2236] transition text-sm flex items-center justify-center"
          >✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#141a2a] shrink-0 px-2 pt-1">
          {TABS.map(tb => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors ${
                tab === tb.id
                  ? 'text-blue-300 bg-[#0f1422] border-b-2 border-blue-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'method' && <TabMethod />}
          {tab === 'loads'  && <TabLoads codeStandard={codeStandard} structureType={structureType} appliedLoads={appliedLoads} />}
          {tab === 'stress' && <TabStress />}
          {tab === 'safety' && <TabSafety codeStandard={codeStandard} />}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#141a2a] shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-gray-600">
            {t('tmFooterDesc')}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-[#0f1422] text-gray-400
                       border border-[#1b2236] hover:bg-[#1b2236] hover:text-gray-200 transition"
          >
            {t('tmClose')}
          </button>
        </div>
      </div>
    </div>
  );
}
