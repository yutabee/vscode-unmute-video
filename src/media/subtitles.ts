import * as path from 'path';

export function srtToVtt(srt: string): string {
    const body = srt
        .replace(/\r\n?/g, '\n')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return `WEBVTT\n\n${body}`;
}

export function sidecarCandidates(videoFsPath: string): string[] {
    const dir = path.dirname(videoFsPath);
    const ext = path.extname(videoFsPath);
    const basename = path.basename(videoFsPath, ext);
    return [
        path.join(dir, `${basename}.vtt`),
        path.join(dir, `${basename}.srt`),
    ];
}
