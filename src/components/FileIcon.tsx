import { useState } from "react";
import { FileCode2 } from "lucide-react";
import mappings from "../generated/file-icons.json";

function resolveIcon(filePath: string, theme: "light" | "dark") {
  const name =
    filePath.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() || "";
  const map = mappings[theme] as {
    fileNames: Record<string, string>;
    fileExtensions: Record<string, string>;
  };
  if (map.fileNames[name]) return map.fileNames[name];
  const pieces = name.split(".");
  for (let index = 1; index < pieces.length; index++) {
    const id = map.fileExtensions[pieces.slice(index).join(".")];
    if (id) return id;
  }
}
export default function FileIcon({
  path,
  size = 16,
}: {
  path: string;
  size?: number;
}) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const dark = resolveIcon(path, "dark"),
    light = resolveIcon(path, "light");
  if (!dark || failedPath === path)
    return (
      <FileCode2
        className="file-icon"
        size={size}
        data-file-icon="fallback"
        aria-hidden="true"
      />
    );
  return (
    <span
      className="type-file-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-file-icon={dark}
    >
      <img
        className="type-icon-dark"
        src={`./file-icons/${dark}.svg`}
        width={size}
        height={size}
        alt=""
        onError={() => setFailedPath(path)}
      />
      <img
        className="type-icon-light"
        src={`./file-icons/${light || dark}.svg`}
        width={size}
        height={size}
        alt=""
        onError={() => setFailedPath(path)}
      />
    </span>
  );
}
