/** Original, sponsor-free illustrations (UI spec §7, route B). Decorative only. */
export function CardBattleArt() {
  return (
    <svg
      viewBox="0 0 320 180"
      className="h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="cb-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0d2a24" />
          <stop offset="1" stopColor="#07111F" />
        </linearGradient>
        <linearGradient id="cb-frame" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#D6E1ED" />
          <stop offset="0.5" stopColor="#9AAFC4" />
          <stop offset="1" stopColor="#D6E1ED" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#cb-bg)" />
      {[-18, 0, 18].map((rot, i) => (
        <g
          key={rot}
          transform={`translate(${130 + i * 30} ${40 + Math.abs(rot) / 3}) rotate(${rot} 30 50)`}
        >
          <rect
            width="64"
            height="90"
            rx="8"
            fill="#101E30"
            stroke="url(#cb-frame)"
            strokeWidth="2.5"
          />
          <rect
            x="6"
            y="6"
            width="52"
            height="46"
            rx="5"
            fill={i === 1 ? '#44E0B1' : '#172941'}
            opacity={i === 1 ? 0.25 : 1}
          />
          <circle cx="32" cy="24" r="9" fill="#F4F7FB" opacity="0.85" />
          <path d="M18 50 q14 -18 28 0" fill="#F4F7FB" opacity="0.85" />
          {[0, 1, 2].map((r) => (
            <rect
              key={r}
              x="8"
              y={58 + r * 9}
              width={r === 1 ? 30 : 44}
              height="4"
              rx="2"
              fill="#B5C3D6"
              opacity="0.6"
            />
          ))}
        </g>
      ))}
      <circle cx="60" cy="140" r="34" fill="#44E0B1" opacity="0.08" />
    </svg>
  );
}

export function AuctionArt() {
  return (
    <svg
      viewBox="0 0 320 180"
      className="h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="au-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2540" />
          <stop offset="1" stopColor="#07111F" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#au-bg)" />
      <path d="M40 150 h240 v8 H40z" fill="#172941" />
      <path d="M120 150 l14 -40 h52 l14 40z" fill="#101E30" stroke="#F0C879" strokeWidth="1.5" />
      <g transform="translate(176 56) rotate(-28)">
        <rect x="0" y="0" width="56" height="18" rx="5" fill="#F0C879" />
        <rect x="24" y="16" width="8" height="46" rx="3" fill="#cfa85e" />
      </g>
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${44 + i * 82} ${40 + (i % 2) * 14})`}>
          <rect width="46" height="34" rx="6" fill="#172941" stroke="#334B66" />
          <text
            x="23"
            y="22"
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill="#F0C879"
            fontFamily="sans-serif"
          >
            {['₹2.0', '₹2.2', '₹2.4'][i]}
          </text>
        </g>
      ))}
    </svg>
  );
}
