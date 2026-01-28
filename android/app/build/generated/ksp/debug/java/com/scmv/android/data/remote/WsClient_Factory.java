package com.scmv.android.data.remote;

import dagger.internal.DaggerGenerated;
import dagger.internal.Factory;
import dagger.internal.QualifierMetadata;
import dagger.internal.ScopeMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;
import okhttp3.OkHttpClient;

@ScopeMetadata("javax.inject.Singleton")
@QualifierMetadata
@DaggerGenerated
@Generated(
    value = "dagger.internal.codegen.ComponentProcessor",
    comments = "https://dagger.dev"
)
@SuppressWarnings({
    "unchecked",
    "rawtypes",
    "KotlinInternal",
    "KotlinInternalInJava"
})
public final class WsClient_Factory implements Factory<WsClient> {
  private final Provider<OkHttpClient> okHttpClientProvider;

  public WsClient_Factory(Provider<OkHttpClient> okHttpClientProvider) {
    this.okHttpClientProvider = okHttpClientProvider;
  }

  @Override
  public WsClient get() {
    return newInstance(okHttpClientProvider.get());
  }

  public static WsClient_Factory create(Provider<OkHttpClient> okHttpClientProvider) {
    return new WsClient_Factory(okHttpClientProvider);
  }

  public static WsClient newInstance(OkHttpClient okHttpClient) {
    return new WsClient(okHttpClient);
  }
}
