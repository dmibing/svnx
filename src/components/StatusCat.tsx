import { useEffect, useRef, useState } from "react";

const reactions = [
  "喵～摸摸收到啦",
  "我在这里，陪你写代码。",
  "好啦，继续趴着陪你。",
];
export default function StatusCat({ quiet }: { quiet: boolean }) {
  const [frame, setFrame] = useState(2);
  const [pose, setPose] = useState("sleep");
  const [message, setMessage] = useState("");
  const [awake, setAwake] = useState(
    () => !document.hidden && document.hasFocus(),
  );
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const clicks = useRef(0);
  const clear = () => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
  };
  const later = (action: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      action();
    }, delay);
    timers.current.add(timer);
  };
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    const visible = () => setAwake(!document.hidden && document.hasFocus());
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("blur", visible);
    return () => {
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("blur", visible);
    };
  }, []);
  const idle = () => {
    if (quiet || reduced || !awake) return;
    later(() => {
      if (document.querySelector('[role="dialog"]')) {
        idle();
        return;
      }
      setPose("peek");
      setFrame(0);
      later(() => setFrame(1), 2200);
      later(() => {
        setFrame(4);
        setPose("rest");
      }, 2600);
      later(() => {
        setFrame(2);
        setPose("sleep");
        idle();
      }, 6000);
    }, 90000);
  };
  useEffect(() => {
    clear();
    setFrame(2);
    setPose("sleep");
    setMessage("");
    idle();
    return clear;
  }, [quiet, reduced, awake]);
  const pet = () => {
    clear();
    setPose("pet");
    setFrame(6);
    setMessage(reactions[clicks.current++ % reactions.length]);
    if (!reduced) {
      later(() => setFrame(7), 550);
      later(() => setFrame(6), 1300);
    }
    later(() => {
      setFrame(2);
      setPose("sleep");
      setMessage("");
      idle();
    }, 3200);
  };
  return (
    <span className="status-cat" data-pose={pose}>
      <button
        className="status-cat-button"
        aria-label="摸摸小猫"
        title="摸摸小猫（可在偏好设置中关闭）"
        onClick={pet}
      >
        <span
          className="status-cat-sprite"
          aria-hidden="true"
          style={{
            backgroundImage: 'url("./status-cat/atlas.png")',
            backgroundPosition: `${-(frame % 4) * 32}px ${-Math.floor(frame / 4) * 32}px`,
            transform: frame >= 4 ? "translateY(4px)" : undefined,
          }}
        />
      </button>
      {message && (
        <span className="status-cat-message" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
