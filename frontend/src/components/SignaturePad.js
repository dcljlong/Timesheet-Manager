import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { Button } from "../components/ui/button";
import { Eraser } from "lucide-react";

const SignaturePad = forwardRef(({ onSignatureChange, initialSignature, label, disabled = false }, ref) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useImperativeHandle(ref, () => ({
    clear: () => clearSignature(),
    getSignature: () => getSignatureData(),
    isEmpty: () => !hasSignature
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    
    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    
    // Set drawing style
    ctx.strokeStyle = "#0A0A0A";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Load initial signature if provided
    if (initialSignature) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
        setHasSignature(true);
      };
      img.src = initialSignature;
    }
  }, [initialSignature]);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    if (e.touches) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e) => {
    if (disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = getCoordinates(e);
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = getCoordinates(e);
    
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = (e) => {
    if (disabled) return;
    e.preventDefault();
    setIsDrawing(false);
    
    if (hasSignature && onSignatureChange) {
      onSignatureChange(getSignatureData());
    }
  };

  const getSignatureData = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return null;
    return canvas.toDataURL("image/png");
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasSignature(false);
    
    if (onSignatureChange) {
      onSignatureChange(null);
    }
  };

  return (
    <div className="space-y-2" data-testid="signature-pad">
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">{label}</label>
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearSignature}
              className="text-gray-500 hover:text-gray-700"
              data-testid="clear-signature"
            >
              <Eraser className="w-4 h-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`signature-canvas w-full h-32 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        data-testid="signature-canvas"
      />
      <p className="text-xs text-gray-500">
        {disabled ? "Signature locked" : "Sign using mouse or finger"}
      </p>
    </div>
  );
});

SignaturePad.displayName = "SignaturePad";

export default SignaturePad;
