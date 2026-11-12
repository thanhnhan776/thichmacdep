import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { SeoTitleStrategy } from './seo';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: TitleStrategy, useClass: SeoTitleStrategy },
    provideRouter(routes, withComponentInputBinding()), provideClientHydration(), provideHttpClient()
  ]
};
