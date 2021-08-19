#include "pxt.h"

namespace ml4f {

struct Header {
  uint32_t magic;
  uint32_t magic1;
  uint32_t startOffset;
  // ...
};

typedef void (*model_fn_t)(const uint8_t *, uint8_t *);

//%
void _invokeModel(Buffer model, Buffer arena) {
  auto hd = (Header *)model->data;
  if (hd->magic != 0x30470f62)
    target_panic(999);
  auto fn = (model_fn_t)(model->data + hd->startOffset + 1);
  fn(model->data, arena->data);
}

} // namespace ml4f
