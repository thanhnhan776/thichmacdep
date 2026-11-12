import { Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageService } from './language';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: '<main><h1>{{ language.text().pageMissing }}</h1><a routerLink="/">{{ language.text().home }}</a></main>',
})
export class NotFound {
  readonly language = inject(LanguageService);
  constructor() {
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
  }
}
