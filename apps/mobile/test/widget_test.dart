import 'package:datacube_au/app/app.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('renders the DataCube AU mobile foundation', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const DataCubeAuApp());

    expect(find.text('DataCube AU'), findsOneWidget);
    expect(find.text('Your learning workspace'), findsOneWidget);
  });
}
