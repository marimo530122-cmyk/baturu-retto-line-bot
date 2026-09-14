"""ステップ4: FFmpegによる最終レンダリング。

各シーンをKen Burズームエフェクト付きの動画クリップに変換し、
無劣化concatで結合、最後に1回だけ音声・字幕と合わせて本エンコードする。
シーン動画長=そのシーンの実際のナレーション音声長 なので、
音声・映像・字幕はフレーム単位でズレない。
"""
from __future__ import annotations

import logging
from pathlib import Path

from .subtitles import generate_ass
from .timeline import SceneScript
from .utils import PipelineError, ffprobe_dimensions, ffprobe_duration_sec, require_binaries, run

logger = logging.getLogger("shorts_pipeline.render")


def _escape_filter_path(path: str) -> str:
    p = str(Path(path).resolve())
    return p.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _escape_concat_path(path: str) -> str:
    p = str(Path(path).resolve())
    return p.replace("'", "'\\''")


def _camera_filter_args(camera: str, frames: int) -> tuple[str, str, str]:
    if camera == "zoom_out":
        z = "if(eq(on,0),1.2,max(zoom-0.0016,1.0))"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    elif camera == "pan_left":
        z = "1.15"
        x = f"(iw-iw/zoom)*(1-on/{max(frames - 1, 1)})"
        y = "ih/2-(ih/zoom/2)"
    elif camera == "pan_right":
        z = "1.15"
        x = f"(iw-iw/zoom)*(on/{max(frames - 1, 1)})"
        y = "ih/2-(ih/zoom/2)"
    else:  # zoom_in (default)
        z = "min(zoom+0.0016,1.2)"
        x = "iw/2-(iw/zoom/2)"
        y = "ih/2-(ih/zoom/2)"
    return z, x, y


def _render_scene_clip(scene: SceneScript, width: int, height: int, fps: int, work_dir: Path) -> Path:
    clip_path = work_dir / f"{scene.id}.mp4"
    frames = max(1, round(scene.duration_sec * fps))
    scale_w, scale_h = int(width * 1.5), int(height * 1.5)
    z, x, y = _camera_filter_args(scene.camera, frames)

    vf = (
        f"scale={scale_w}:{scale_h}:force_original_aspect_ratio=increase,"
        f"crop={scale_w}:{scale_h},"
        f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={width}x{height}:fps={fps},"
        f"format=yuv420p"
    )

    run(
        [
            "ffmpeg",
            "-y",
            "-loop",
            "1",
            "-i",
            scene.image_path,
            "-t",
            f"{scene.duration_sec:.3f}",
            "-vf",
            vf,
            "-r",
            str(fps),
            "-pix_fmt",
            "yuv420p",
            str(clip_path),
        ]
    )
    return clip_path


def _concat(paths: list[Path], output: Path, list_file: Path) -> None:
    list_file.write_text("".join(f"file '{_escape_concat_path(str(p))}'\n" for p in paths), encoding="utf-8")
    run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_file),
            "-c",
            "copy",
            str(output),
        ]
    )


def render(scenes: list[SceneScript], config: dict, cache_dir: Path) -> Path:
    require_binaries("ffmpeg", "ffprobe")

    project_cfg = config.get("project", {})
    video_cfg = project_cfg.get("video", {})
    width = int(video_cfg.get("width", 1080))
    height = int(video_cfg.get("height", 1920))
    fps = int(video_cfg.get("fps", 30))
    output_path = Path(project_cfg.get("output_path", "output.mp4"))

    work_dir = cache_dir / "render"
    work_dir.mkdir(parents=True, exist_ok=True)

    logger.info("シーンごとの動画クリップを生成中 (Ken Burnsエフェクト)...")
    clip_paths = [_render_scene_clip(scene, width, height, fps, work_dir) for scene in scenes]

    logger.info("動画クリップを無劣化結合中...")
    silent_video = work_dir / "silent_full.mp4"
    _concat(clip_paths, silent_video, work_dir / "video_concat_list.txt")

    logger.info("ナレーション音声を結合中...")
    narration_full = work_dir / "narration_full.mp3"
    audio_paths = [Path(scene.audio_path) for scene in scenes]
    _concat(audio_paths, narration_full, work_dir / "audio_concat_list.txt")

    logger.info("字幕(.ass)を生成中...")
    ass_path = generate_ass(scenes, config, work_dir / "subtitles.ass")

    total_duration = (scenes[-1].start_sec or 0.0) + (scenes[-1].duration_sec or 0.0)
    fade_duration = min(0.4, total_duration / 10)

    sub_cfg = config.get("subtitles", {})
    font_dir = sub_cfg.get("font_dir")
    ass_filter = f"ass='{_escape_filter_path(str(ass_path))}'"
    if font_dir and Path(font_dir).exists():
        ass_filter += f":fontsdir='{_escape_filter_path(font_dir)}'"

    vf = (
        f"{ass_filter},"
        f"fade=t=in:st=0:d={fade_duration:.2f},"
        f"fade=t=out:st={max(total_duration - fade_duration, 0):.2f}:d={fade_duration:.2f}"
    )
    af = (
        f"afade=t=in:st=0:d={fade_duration:.2f},"
        f"afade=t=out:st={max(total_duration - fade_duration, 0):.2f}:d={fade_duration:.2f}"
    )

    logger.info("最終エンコード中 -> %s", output_path)
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(silent_video),
            "-i",
            str(narration_full),
            "-vf",
            vf,
            "-af",
            af,
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(fps),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )

    _validate_output(output_path)
    logger.info("完成: %s (%.2f秒)", output_path, ffprobe_duration_sec(output_path))
    return output_path


def _validate_output(path: Path) -> None:
    if not path.exists():
        raise PipelineError(f"出力ファイルが生成されませんでした: {path}")
    w, h = ffprobe_dimensions(path)
    if w >= h:
        raise PipelineError(f"出力動画が縦型(9:16)になっていません: {w}x{h}")
    duration = ffprobe_duration_sec(path)
    if duration > 60:
        logger.warning("動画の長さが60秒を超えています (%.2f秒): YouTube Shortsとして認識されない可能性があります", duration)
