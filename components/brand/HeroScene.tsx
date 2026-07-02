import type { CSSProperties } from "react";

const particles = Array.from({ length: 102 }, (_, index) => ({
  index,
  x: `${46 + ((index * 19) % 51)}%`,
  y: `${10 + ((index * 29) % 74)}%`,
  size: `${1.2 + ((index * 5) % 9)}px`,
  delay: `${(index % 13) * 0.22}s`,
  duration: `${4.6 + (index % 9) * 0.5}s`
}));

const galaxyParticles = Array.from({ length: 216 }, (_, index) => {
  const ring = index % 12;

  return {
    index,
    angle: `${(index * 31 + ring * 17) % 360}deg`,
    radius: `clamp(${88 + ring * 16}px, ${7 + ring * 1.2}vw, ${155 + ring * 24}px)`,
    size: `${1.4 + ((index * 7) % 9)}px`,
    delay: `${-1 * ((index * 0.42) % 18)}s`,
    duration: `${18 + ring * 2.7 + (index % 6) * 1.15}s`,
    opacity: `${0.28 + (index % 7) * 0.075}`,
    scaleY: `${0.28 + (ring % 5) * 0.07}`
  };
});

const backGalaxyParticles = galaxyParticles.filter((particle) => particle.index % 2 === 0);
const frontGalaxyParticles = galaxyParticles.filter((particle) => particle.index % 2 === 1);

export function HeroScene() {
  return (
    <div className="brand-hero-scene" aria-hidden="true">
      <div className="hero-visual-glow" />
      <div className="hero-visual-foot-glow" />

      <div className="hero-visual-galaxy-particles hero-visual-galaxy-particles-back">
        {backGalaxyParticles.map((particle) => (
          <span
            key={particle.index}
            className="hero-visual-galaxy-particle"
            style={{
              "--galaxy-angle": particle.angle,
              "--galaxy-radius": particle.radius,
              "--galaxy-size": particle.size,
              "--galaxy-delay": particle.delay,
              "--galaxy-duration": particle.duration,
              "--galaxy-opacity": particle.opacity,
              "--galaxy-scale-y": particle.scaleY
            } as CSSProperties}
          />
        ))}
      </div>

      <span className="hero-visual-layer hero-visual-character-v2">
        <img src="/hero-assets/hero-character-v2.png" alt="" className="hero-visual-image" draggable={false} />
      </span>

      <div className="hero-visual-galaxy-particles hero-visual-galaxy-particles-front">
        {frontGalaxyParticles.map((particle) => (
          <span
            key={particle.index}
            className="hero-visual-galaxy-particle"
            style={{
              "--galaxy-angle": particle.angle,
              "--galaxy-radius": particle.radius,
              "--galaxy-size": particle.size,
              "--galaxy-delay": particle.delay,
              "--galaxy-duration": particle.duration,
              "--galaxy-opacity": particle.opacity,
              "--galaxy-scale-y": particle.scaleY
            } as CSSProperties}
          />
        ))}
      </div>

      <div className="hero-visual-particles">
        {particles.map((particle) => (
          <span
            key={particle.index}
            className="hero-visual-particle"
            style={{
              "--particle-x": particle.x,
              "--particle-y": particle.y,
              "--particle-size": particle.size,
              "--particle-delay": particle.delay,
              "--particle-duration": particle.duration
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
