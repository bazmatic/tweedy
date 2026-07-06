import ffmpeg from "fluent-ffmpeg";
import * as path from "path";
import * as fs from "fs-extra";
import { logger } from "../utils/logger";

export class AudioProcessor {
  static async processAudio(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(outputPath));

      return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            "-af",
            "silenceremove=1:0:-50dB:1:0:-50dB", // Remove silence
            "-af",
            "loudnorm=I=-16:LRA=11:TP=-1.5", // Normalize audio
          ])
          .output(outputPath)
          .on("end", () => {
            logger.debug(`Audio processed: ${outputPath}`);
            resolve();
          })
          .on("error", (error: Error) => {
            logger.error("Audio processing failed:", error);
            reject(error);
          })
          .run();
      });
    } catch (error) {
      logger.error("Failed to process audio:", error);
      throw error;
    }
  }

  static async concatenateAudio(
    inputFiles: string[],
    outputPath: string
  ): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(outputPath));

      // Create a temporary file list for ffmpeg
      const listPath = path.join(path.dirname(outputPath), "concat_list.txt");
      const listContent = inputFiles
        .map((file) => `file '${path.resolve(file)}'`)
        .join("\n");
      await fs.writeFile(listPath, listContent);

      return new Promise((resolve, reject) => {
        ffmpeg()
          .input(listPath)
          .inputOptions(["-f", "concat", "-safe", "0"])
          .outputOptions([
            "-af",
            "loudnorm=I=-16:LRA=11:TP=-1.5", // Normalize final audio
            "-af",
            "silenceremove=1:0:-50dB:1:0:-50dB", // Remove silence
          ])
          .output(outputPath)
          .on("end", async () => {
            // Clean up temporary file
            await fs.remove(listPath);
            logger.info(`Audio concatenated: ${outputPath}`);
            resolve();
          })
          .on("error", async (error: Error) => {
            // Clean up temporary file
            await fs.remove(listPath);
            logger.error("Audio concatenation failed:", error);
            reject(error);
          })
          .run();
      });
    } catch (error) {
      logger.error("Failed to concatenate audio:", error);
      throw error;
    }
  }

  static async getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata.format.duration || 0);
        }
      });
    });
  }
}
