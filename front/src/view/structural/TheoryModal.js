import React, { useState } from 'react';

// ──────────────────────────────────────────────────────────────────────────────
// 이론 설명 모달
// props:
//   open           : boolean
//   onClose        : () => void
//   codeStandard   : 'KDS' | 'EUROCODE2'
//   structureType  : 'BUILDING' | 'BRIDGE'
//   appliedLoads   : { deadLoad, liveLoad, windLoad, seismicForce, governingCombo }
// ──────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'method',  label: '해석 방법' },
  { id: 'loads',   label: '하중 계산' },
  { id: 'stress',  label: '응력 산출' },
  { id: 'safety',  label: '안전 기준' },
];

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

// ── 탭별 내용 ──────────────────────────────────────────────────────────────────

function TabMethod() {
  return (
    <>
      <Section title="직접강성법 (DSM) 이란?">
        구조물 전체를 작은 부재(보, 기둥)의 집합으로 보고,
        각 부재의 "뻣뻣함(강성)"을 합산해 전체 방정식을 만든 뒤,
        변위와 힘을 동시에 구하는 방법입니다.
      </Section>

      <Section title="핵심 방정식">
        <Formula>{`[K] · {U} = {F}

K  전체 강성 행렬  — 구조물이 얼마나 뻣뻣한지
U  절점 변위 벡터  — 각 점이 얼마나 움직이는지
F  외력 벡터       — 어떤 하중이 어디에 작용하는지`}</Formula>
        K와 F를 알면 U를 구할 수 있고, U로 각 부재에 걸리는 힘을 역산합니다.
      </Section>

      <Section title="3D 모델 설정">
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div className="bg-[#0f1422] border border-[#1b2236] rounded-xl p-2.5">
            <p className="text-blue-400 font-bold mb-1">절점 (Node)</p>
            <p className="text-gray-500">부재가 만나는 점. 각 절점에 6개의 자유도(이동 3 + 회전 3)가 있습니다.</p>
          </div>
          <div className="bg-[#0f1422] border border-[#1b2236] rounded-xl p-2.5">
            <p className="text-blue-400 font-bold mb-1">부재 (Element)</p>
            <p className="text-gray-500">두 절점을 잇는 선. 부재마다 12×12 강성 행렬을 계산합니다.</p>
          </div>
          <div className="bg-[#0f1422] border border-[#1b2236] rounded-xl p-2.5">
            <p className="text-blue-400 font-bold mb-1">자유도 (DOF)</p>
            <p className="text-gray-500">절점당 6 DOF = 이동 [uₓ, u_y, u_z] + 회전 [θₓ, θ_y, θ_z]</p>
          </div>
          <div className="bg-[#0f1422] border border-[#1b2236] rounded-xl p-2.5">
            <p className="text-blue-400 font-bold mb-1">경계 조건</p>
            <p className="text-gray-500">지면 절점은 6 DOF 모두 고정. 바닥에서 이동·회전 불가.</p>
          </div>
        </div>
      </Section>

      <Section title="계산 흐름">
        <div className="flex flex-col gap-1">
          {[
            ['① BIM 파싱',    '부재 위치·크기에서 절점 좌표와 단면 치수 추출'],
            ['② 강성 조립',   '각 부재의 12×12 국부 강성 → 좌표 변환 → 전체 K 행렬'],
            ['③ 하중 계산',   '고정·활·풍·지진 하중을 각 절점에 분배'],
            ['④ 방정식 풀기', '가우스 소거법으로 K·U=F 풀어 변위 U 획득'],
            ['⑤ 부재력 산출', '변위 → 부재력(축·전단·모멘트·비틀림) 역산'],
            ['⑥ 안전 판정',   '응력 계산 후 허용응력(KDS) 또는 설계강도(EC2)와 비교'],
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
  const isKDS  = codeStandard === 'KDS';
  const isBrdg = structureType === 'BRIDGE';

  return (
    <>
      <Section title="고정하중 (Dead Load)">
        <Formula>{`W_self = γ × b × h × L

γ  단위중량  [콘크리트 24 kN/m³ / 강재 78.5 kN/m³]
b × h  단면적 (m²)
L  부재 길이 (m)`}</Formula>
        {appliedLoads?.deadLoad != null && (
          <p className="text-blue-300 mt-1">현재 적용 값: <span className="font-mono">{appliedLoads.deadLoad.toFixed(1)} kN</span></p>
        )}
      </Section>

      <Section title="활하중 (Live Load)">
        <Formula>{isKDS
          ? `q_L  [kN/m²]  ×  바닥 면적 [m²]\n\n사무실 2.5 / 주거 2.0 / 주차 5.0 kN/m²`
          : `q_k  [kN/m²]  ×  바닥 면적 [m²]\n\nCategory B(사무) 3.0 / A(주거) 2.0 kN/m²`
        }</Formula>
        {appliedLoads?.liveLoad != null && (
          <p className="text-blue-300 mt-1">현재 적용 값: <span className="font-mono">{appliedLoads.liveLoad.toFixed(1)} kN</span></p>
        )}
      </Section>

      <Section title={isBrdg ? '교통하중' : '풍하중'}>
        {!isBrdg && (
          <Formula>{isKDS
            ? `q_w = 0.6125 × V₀² / 1000 × Kd × Kzt × Cf × G\n\n풍속 V₀ = 30 m/s 기준, 설계풍압 (kN/m²)`
            : `q_p = Ce × 0.5 × ρ × vb²\nFw  = q_p × Cf × 노출면적\n\n기본풍속 vb = 28 m/s 기준`
          }</Formula>
        )}
        {isBrdg && (
          <Formula>{isKDS
            ? `DB-24: P_truck = 240 kN, w_lane = 12.7 kN/m`
            : `LM1:   Q_1k = 300 kN (탠덤), q_1k = 9 kN/m²`
          }</Formula>
        )}
        {appliedLoads?.windLoad != null && (
          <p className="text-blue-300 mt-1">현재 적용 값: <span className="font-mono">{appliedLoads.windLoad.toFixed(1)} kN</span></p>
        )}
      </Section>

      <Section title="지진하중 (Seismic)">
        <Formula>{isKDS
          ? `V = Cs × W\nCs = SDS / (R / Ie)\n\nSDS 설계스펙트럼가속도, R 반응수정계수, Ie 중요도계수`
          : `Fb = Sd(T₁) × m × λ\nSd = ag × S × 2.5 / q\n\nag 설계가속도, S 지반계수, q 거동계수`
        }</Formula>
        {appliedLoads?.seismicForce != null && (
          <p className="text-blue-300 mt-1">현재 적용 값: <span className="font-mono">{appliedLoads.seismicForce.toFixed(1)} kN</span></p>
        )}
      </Section>

      <Section title="하중 조합">
        <Formula>{isKDS
          ? `① 1.4D\n② 1.2D + 1.6L          ← 대부분 건물의 지배 조합\n③ 1.2D + 1.0W + L\n④ 1.2D + 1.0E + L\n⑤ 0.9D + 1.0W`
          : `① 1.35G_k + 1.5Q_k\n② 1.35G_k + 1.5Q_k + 0.9W_k\n③ 1.0G_k + 1.0Q_k + 1.0A_Ed`
        }</Formula>
        {appliedLoads?.governingCombo != null && (
          <p className="text-amber-300 mt-1 font-semibold">현재 지배 조합: <span className="font-mono">#{appliedLoads.governingCombo}</span></p>
        )}
      </Section>
    </>
  );
}

function TabStress() {
  return (
    <>
      <Section title="부재력 추출">
        변위 벡터 U에서 각 부재의 절점 변위를 가져온 뒤, 국부 좌표계로 변환하여 부재력을 계산합니다.
        <Formula>{`{f_local} = [ke] · [T] · {u_global}

N   축력     (kN)  +인장 / −압축
Vy  전단 y   (kN)
Vz  전단 z   (kN)
Tx  비틀림   (kN·m)
My  모멘트 y (kN·m)  강축 휨
Mz  모멘트 z (kN·m)  약축 휨`}</Formula>
      </Section>

      <Section title="응력 계산">
        <Formula>{`σ_axial   = N / A / 1000                [MPa]
σ_bending = M_max × c / I / 1000      [MPa]
τ_shear   = 1.5 × V_res / A / 1000   [MPa]
τ_torsion ≈ Tx × c / (2·Iy·Iz/(Iy+Iz)) / 1000 [MPa]

V_res = √(Vy² + Vz²)
σ_total = |σ_axial| + σ_bend_y + σ_bend_z`}</Formula>
        <div className="mt-2 text-gray-500">
          ÷1000 은 kN/m² → MPa 단위 변환 계수입니다.
        </div>
      </Section>

      <Section title="단면 물성 (직사각형)">
        <div className="flex flex-col gap-0.5">
          <VarRow sym="A = b×h"      desc="단면적 (m²)" />
          <VarRow sym="Iz = b·h³/12" desc="강축 단면2차모멘트 (m⁴)" />
          <VarRow sym="Iy = h·b³/12" desc="약축 단면2차모멘트 (m⁴)" />
          <VarRow sym="J"            desc="Saint-Venant 비틀림 상수 (m⁴)" />
          <VarRow sym="c = h/2"      desc="중립면에서 극단까지 거리 (m)" />
          <VarRow sym="G = E/2(1+ν)" desc="전단탄성계수 (ν=0.2 콘크리트, 0.3 강재)" />
        </div>
      </Section>

      <Section title="국부 좌표계">
        각 부재는 자신만의 3축 좌표계를 가집니다.
        <div className="mt-1 flex flex-col gap-0.5">
          <VarRow sym="local-x" desc="부재 축 방향 (n1→n2 단위벡터)" />
          <VarRow sym="local-y" desc="약축 방향 (수직 부재: East, 수평 보: 옆)" />
          <VarRow sym="local-z" desc="강축 방향 (수평 보: 위쪽)" />
        </div>
        <p className="text-gray-500 mt-1">
          global 좌표 → local 변환 행렬 T (12×12)로 강성·힘을 변환합니다.
        </p>
      </Section>
    </>
  );
}

function TabSafety({ codeStandard }) {
  const isKDS = codeStandard === 'KDS';
  return (
    <>
      {isKDS ? (
        <>
          <Section title="KDS — 허용응력설계 (ASD)">
            구조물의 실제 응력이 허용응력을 초과하지 않도록 설계합니다.
            <Formula>{`SF = f_allow / σ_total

f_allow (콘크리트) = f_ck / SF_safe  예) 24 / 2.0 = 12 MPa
f_allow (강재)    = f_y  / SF_safe  예) 235 / 2.0 = 117.5 MPa`}</Formula>
            <div className="mt-1 flex flex-col gap-1">
              <VarRow sym="SF ≥ 2.0" desc="Safe  — 충분한 안전 여유" />
              <VarRow sym="1.0 ≤ SF < 2.0" desc="Warning  — 설계 기준 초과 위험" />
              <VarRow sym="SF < 1.0" desc="Danger  — 허용응력 초과, 즉각 검토 필요" />
            </div>
          </Section>
          <Section title="복합 하중 상관 관계">
            <Formula>{`ratio = (σ_total / f_allow) + (τ_total / f_allow_v)

SF = 1 / ratio

f_allow_v (콘크리트) ≈ 0.4 × √f_ck  ≈ 2.0 MPa
f_allow_v (강재)    = f_y / (√3 × SF_safe)`}</Formula>
          </Section>
        </>
      ) : (
        <>
          <Section title="Eurocode 2 — 한계상태설계 (LRFD)">
            설계하중 효과(Ed)가 설계저항(Rd)을 초과하지 않도록 설계합니다.
            <Formula>{`U = σ_Ed / σ_Rd  (활용률)

σ_Rd (콘크리트) = f_ck / γ_c   예) 24 / 1.5 = 16 MPa
σ_Rd (강재)    = f_y  / γ_M0  예) 235 / 1.0 = 235 MPa`}</Formula>
            <div className="mt-1 flex flex-col gap-1">
              <VarRow sym="U ≤ 0.70" desc="Safe  — 설계강도의 70% 이하" />
              <VarRow sym="0.70 < U ≤ 1.0" desc="Warning  — 설계강도 근접" />
              <VarRow sym="U > 1.0" desc="Danger  — 설계강도 초과, 보강 필요" />
            </div>
          </Section>
          <Section title="재료 분할계수 (γ)">
            <div className="flex flex-col gap-0.5">
              <VarRow sym="γ_c = 1.5"  desc="콘크리트 — 불확실성 반영" />
              <VarRow sym="γ_M0 = 1.0" desc="강재 단면 항복/좌굴" />
              <VarRow sym="γ_M1 = 1.0" desc="강재 불안정 (좌굴)" />
            </div>
          </Section>
        </>
      )}

      <Section title="3D 색상 시각화">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-green-500 shrink-0" />
            <span>Safe — 구조적으로 안전한 부재</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-amber-500 shrink-0" />
            <span>Warning — 여유가 적거나 허용 한계에 근접</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-red-500 shrink-0" />
            <span>Danger — 허용 기준 초과, 설계 검토 필요</span>
          </div>
        </div>
        <p className="text-gray-500 mt-2">
          BIM 모델 위에 색상으로 겹쳐 표시되므로, 문제가 되는 부재를 3D 공간에서 직접 확인할 수 있습니다.
        </p>
      </Section>
    </>
  );
}

// ── 메인 모달 컴포넌트 ─────────────────────────────────────────────────────────

export default function TheoryModal({ open, onClose, codeStandard = 'KDS', structureType = 'BUILDING', appliedLoads }) {
  const [tab, setTab] = useState('method');

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
            <span className="text-base font-bold text-gray-100">📐 구조해석 이론 가이드</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-600/30">
              {codeStandard === 'EUROCODE2' ? 'EC2' : codeStandard} · {structureType === 'BRIDGE' ? '교량' : '건물'}
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
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors ${
                tab === t.id
                  ? 'text-blue-300 bg-[#0f1422] border-b-2 border-blue-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'method' && <TabMethod />}
          {tab === 'loads'  && <TabLoads  codeStandard={codeStandard} structureType={structureType} appliedLoads={appliedLoads} />}
          {tab === 'stress' && <TabStress />}
          {tab === 'safety' && <TabSafety codeStandard={codeStandard} />}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#141a2a] shrink-0 flex items-center justify-between">
          <p className="text-[10px] text-gray-600">
            3D 직접강성법 (DSM) · Euler-Bernoulli 보 이론 · 6 DOF/절점
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-[#0f1422] text-gray-400
                       border border-[#1b2236] hover:bg-[#1b2236] hover:text-gray-200 transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
