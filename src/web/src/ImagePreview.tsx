import { Modal } from "./Modal";
import "./image-preview.css";

export function ImagePreview({
  src,
  alt,
  close,
}: {
  src: string;
  alt: string;
  close: () => void;
}) {
  return (
    <Modal title="图片预览" className="image-preview-dialog" close={close}>
      <img src={src} alt={alt} />
    </Modal>
  );
}
