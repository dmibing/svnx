import { useEffect, useRef, useState, type CSSProperties } from "react";

const reactions = [
  "喵～摸摸收到啦",
  "我在这里，陪你写代码。",
  "好啦，继续趴着陪你。",
];
type Pose =
  "sleep" | "walk" | "chase" | "catch" | "pet" | "look" | "groom" | "stretch";
export default function StatusCat({ quiet }: { quiet: boolean }) {
  const lane = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [pose, setPose] = useState<Pose>("sleep");
  const [frame, setFrame] = useState(2);
  const [message, setMessage] = useState("");
  const [petting, setPetting] = useState(false);
  const [awake, setAwake] = useState(
    () => !document.hidden && document.hasFocus(),
  );
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [trip, setTrip] = useState({
    from: 0,
    to: 0,
    duration: 0,
    direction: 1,
  });
  const clicks = useRef(0);
  const outings = useRef(0);
  const lastPosition = useRef<number | null>(null);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches);
    const visible = () => setAwake(!document.hidden && document.hasFocus());
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    );
    if (lane.current) observer.observe(lane.current);
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("blur", visible);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("blur", visible);
    };
  }, []);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (action: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        action();
      }, delay);
      timers.add(timer);
    };
    const end = Math.max(0, width - 42);
    let position = Math.max(0, Math.min(end, lastPosition.current ?? end));
    const rest = () => {
      setPose("sleep");
      setFrame(2);
      setTrip({ from: position, to: position, duration: 0, direction: 1 });
    };
    if (petting) {
      setPose("pet");
      setFrame(6);
      if (!reduced) {
        later(() => setFrame(7), 550);
        later(() => setFrame(6), 1300);
      }
      later(() => {
        setPetting(false);
        setMessage("");
      }, 3200);
    } else {
      rest();
      setMessage("");
      const stroll = () => {
        if (document.querySelector('[role="dialog"]')) {
          later(stroll, 5000);
          return;
        }
        const outing = outings.current++;
        const choice = outing > 0 ? Math.random() : 1;
        if (outing > 0 && choice >= 0.28 && choice < 0.77) {
          const action =
            choice < 0.45 ? "look" : choice < 0.62 ? "groom" : "stretch";
          setPose(action);
          later(
            () => {
              rest();
              later(stroll, 25000 + Math.random() * 20000);
            },
            action === "look" ? 2400 : action === "groom" ? 4000 : 3200,
          );
          return;
        }
        const chase = outing > 0 && choice < 0.28;
        const destination =
          position > end / 2
            ? Math.max(0, position - 280)
            : Math.min(end, position + 280);
        const duration = Math.max(
          1800,
          (Math.abs(destination - position) / (chase ? 80 : 12)) * 1000,
        );
        setTrip({
          from: position,
          to: destination,
          duration,
          direction: destination >= position ? 1 : -1,
        });
        setPose(chase ? "chase" : "walk");
        position = destination;
        later(() => {
          if (chase) setPose("catch");
          else rest();
          later(
            () => {
              rest();
              later(stroll, 25000 + Math.random() * 20000);
            },
            chase ? 900 : 0,
          );
        }, duration);
      };
      if (!quiet && !reduced && awake && end >= 100) later(stroll, 8000);
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
      const button = lane.current?.querySelector("button");
      if (button && lane.current)
        lastPosition.current =
          button.getBoundingClientRect().left -
          lane.current.getBoundingClientRect().left;
    };
  }, [quiet, reduced, awake, width, petting]);
  const moving = pose === "walk" || pose === "chase";
  const actionSprite = ["walk", "look", "groom", "stretch"].includes(pose);
  const bubbleWidth = Math.min(200, width);
  const bubbleLeft = Math.max(
    0,
    Math.min(width - bubbleWidth, trip.to + 20 - bubbleWidth / 2),
  );
  const style = {
    "--cat-from": `${trip.from}px`,
    "--cat-to": `${trip.to}px`,
    "--cat-duration": `${trip.duration}ms`,
    "--cat-direction": trip.direction,
    "--mouse-from": `${trip.from + trip.direction * 48}px`,
    "--mouse-to": `${trip.to + trip.direction * 10}px`,
    "--bubble-left": `${bubbleLeft}px`,
    "--bubble-width": `${bubbleWidth}px`,
    "--bubble-tail": `${Math.max(12, Math.min(bubbleWidth - 12, trip.to + 20 - bubbleLeft))}px`,
  } as CSSProperties;
  return (
    <span ref={lane} className="status-cat" data-pose={pose} style={style}>
      <span className="status-cat-track">
        <button
          className="status-cat-button"
          aria-label="摸摸小猫"
          title="摸摸小猫（可在偏好设置中关闭）"
          onClick={() => {
            const button = lane.current?.querySelector("button");
            if (button && lane.current) {
              const position =
                button.getBoundingClientRect().left -
                lane.current.getBoundingClientRect().left;
              setTrip({
                from: position,
                to: position,
                duration: 0,
                direction: trip.direction,
              });
            }
            setMessage(reactions[clicks.current++ % reactions.length]);
            setPetting(true);
          }}
        >
          <span
            className={
              actionSprite
                ? "status-cat-action-sprite"
                : moving || pose === "catch"
                  ? "status-cat-runner"
                  : "status-cat-sprite"
            }
            aria-hidden="true"
            style={
              actionSprite || moving || pose === "catch"
                ? undefined
                : {
                    backgroundImage: 'url("./status-cat/atlas.png")',
                    backgroundPosition: `${-(frame % 4) * 32}px ${-Math.floor(frame / 4) * 32}px`,
                    transform: frame >= 4 ? "translateY(4px)" : undefined,
                  }
            }
          />
        </button>
        {pose === "chase" && (
          <span className="status-cat-mouse" aria-hidden="true">
            <span />
          </span>
        )}
      </span>
      {message && (
        <span className="status-cat-message" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
