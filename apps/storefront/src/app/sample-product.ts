import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-sample-product',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <p>ThichMacDep</p>
      <h1>Sample product</h1>
      <p>A preview of the ThichMacDep product catalog.</p>
      <p>This is sample content, not a product available for sale.</p>
    </main>
  `,
})
export class SampleProduct {}
