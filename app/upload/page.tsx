import UploadClient from "./UploadClient";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-semibold">Upload CVs</h1>
      <UploadClient />
    </div>
  );
}
