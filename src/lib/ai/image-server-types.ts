export type PreparedAiImage = {
  id: string;
  mediaType: "image/jpeg";
  data: Buffer;
  sha256: string;
  width: number;
  height: number;
};
