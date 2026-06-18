declare module "gtts" {
  export default class gTTS {
    constructor(text: string, lang?: string);
    save(filePath: string): Promise<void>;
    stream(): NodeJS.ReadableStream;
  }
}
